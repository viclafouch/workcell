import { randomUUIDv7 } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NO_OWNER_EPOCH } from '@tanstack/ai-persistence'
import { runPersistenceConformance } from '@tanstack/ai-persistence/testkit'
import type { Database } from '#/store/database.ts'
import { createHarnessPersistence } from '#/store/harness-persistence.ts'
import { createPostgresLogStore } from '#/store/log-store.ts'
import {
  openTestDatabase,
  SILENT_LOGGER,
  createMigratedDatabase
} from '#/testing/test-database.ts'

const CHAT_STORES = [
  'messages',
  'activities',
  'runs',
  'interrupts',
  'generationRuns'
] as const

const TWIN_LISTEN_TIMEOUT_MS = 10_000

const LOG_VERSION_READ = 'read the version of a log'

const LOG_DELETE = 'delete a log'

const CATCH_UP_TIMEOUT_MS = 10_000

let database: Database
let twinDatabase: Database
let stopTwinListener: () => void

async function listenOnTheTwin() {
  const logId = `twin-probe-${randomUUIDv7()}`
  const primary = createPostgresLogStore({ database, logger: SILENT_LOGGER })
  let isHeard = false
  let seq = 1
  const stopListening = createPostgresLogStore({
    database: twinDatabase,
    logger: SILENT_LOGGER
  }).subscribe({
    logId,
    listener: () => {
      isHeard = true
    }
  })

  await vi.waitFor(
    async () => {
      if (isHeard) {
        return
      }

      await primary.append({
        logId,
        seq,
        epoch: NO_OWNER_EPOCH,
        records: [{ type: 'probe' }]
      })
      seq += 1

      throw new Error('The twin host does not listen yet.')
    },
    { timeout: TWIN_LISTEN_TIMEOUT_MS, interval: 100 }
  )

  return stopListening
}

function listenDuringTheDelete(opened: Database) {
  const query = vi.spyOn(opened, 'query')
  let becomeListening: (() => void) | null = null

  const versionReads = () => {
    return query.mock.calls.filter(([name], index) => {
      return (
        name === LOG_VERSION_READ &&
        query.mock.settledResults[index]?.type === 'fulfilled'
      )
    }).length
  }

  const racedDatabase: Database = {
    ...opened,
    listen: (channel, listener) => {
      becomeListening = () => {
        listener({ kind: 'listening' })
      }

      return opened.listen(channel, (notice) => {
        if (notice.kind !== 'listening') {
          listener(notice)
        }
      })
    },
    transaction: async (name, work) => {
      const result = await opened.transaction(name, work)

      if (name === LOG_DELETE) {
        becomeListening?.()
        await vi.waitFor(
          () => {
            if (versionReads() < 2) {
              throw new Error('The catch-up has read no version yet.')
            }
          },
          { timeout: CATCH_UP_TIMEOUT_MS }
        )
      }

      return result
    }
  }

  return { database: racedDatabase, versionReads }
}

describe('createHarnessPersistence', () => {
  beforeAll(async () => {
    const url = await createMigratedDatabase()
    database = openTestDatabase(url)
    twinDatabase = openTestDatabase(url)
    stopTwinListener = await listenOnTheTwin()
  })

  afterAll(async () => {
    stopTwinListener()
    await database.close()
    await twinDatabase.close()
  })

  it('hears a write that another host makes before its LISTEN is active', async () => {
    const url = await createMigratedDatabase()
    await using writer = openTestDatabase(url)
    await using reader = openTestDatabase(url)
    const logId = `cold-${randomUUIDv7()}`
    let calls = 0
    const stopListening = createPostgresLogStore({
      database: reader,
      logger: SILENT_LOGGER
    }).subscribe({
      logId,
      listener: () => {
        calls += 1
      }
    })

    await createPostgresLogStore({
      database: writer,
      logger: SILENT_LOGGER
    }).append({
      logId,
      seq: 1,
      epoch: NO_OWNER_EPOCH,
      records: [{ type: 'early' }]
    })

    await expect
      .poll(() => {
        return calls
      })
      .toBeGreaterThan(0)
    stopListening()
  })

  it('calls a listener once for its own delete when its LISTEN becomes active as the delete commits', async () => {
    const url = await createMigratedDatabase()
    await using opened = openTestDatabase(url)
    const raced = listenDuringTheDelete(opened)
    const store = createPostgresLogStore({
      database: raced.database,
      logger: SILENT_LOGGER
    })
    const logId = `own-delete-${randomUUIDv7()}`
    let calls = 0
    await store.append({
      logId,
      seq: 1,
      epoch: NO_OWNER_EPOCH,
      records: [{ type: 'before' }]
    })
    const stopListening = store.subscribe({
      logId,
      listener: () => {
        calls += 1
      }
    })
    await vi.waitFor(
      () => {
        expect(raced.versionReads()).toBe(1)
      },
      { timeout: CATCH_UP_TIMEOUT_MS }
    )

    await store.deleteLog({ logId })

    expect(calls).toBe(1)
    stopListening()
  })

  it('calls no listener when its LISTEN becomes active with no write', async () => {
    const url = await createMigratedDatabase()
    await using writer = openTestDatabase(url)
    await using reader = openTestDatabase(url)
    const readerStore = createPostgresLogStore({
      database: reader,
      logger: SILENT_LOGGER
    })
    const writerStore = createPostgresLogStore({
      database: writer,
      logger: SILENT_LOGGER
    })
    const probeLogId = `probe-${randomUUIDv7()}`
    let quietCalls = 0
    let probeCalls = 0
    let seq = 1
    const stopQuiet = readerStore.subscribe({
      logId: `quiet-${randomUUIDv7()}`,
      listener: () => {
        quietCalls += 1
      }
    })
    const stopProbe = readerStore.subscribe({
      logId: probeLogId,
      listener: () => {
        probeCalls += 1
      }
    })
    const appendToProbe = async () => {
      await writerStore.append({
        logId: probeLogId,
        seq,
        epoch: NO_OWNER_EPOCH,
        records: [{ type: 'probe' }]
      })
      seq += 1
    }

    await vi.waitFor(
      async () => {
        await appendToProbe()

        expect(probeCalls).toBeGreaterThan(0)
      },
      { timeout: TWIN_LISTEN_TIMEOUT_MS, interval: 100 }
    )
    const heardCalls = probeCalls
    await appendToProbe()
    await expect
      .poll(() => {
        return probeCalls
      })
      .toBeGreaterThan(heardCalls)
    stopQuiet()
    stopProbe()

    expect(quietCalls).toBe(0)
  })

  describe('in the order of the testkit', { shuffle: false }, () => {
    runPersistenceConformance(
      'Postgres',
      () => {
        return createHarnessPersistence({ database, logger: SILENT_LOGGER })
      },
      {
        skip: [...CHAT_STORES],
        twin: () => {
          return createHarnessPersistence({
            database: twinDatabase,
            logger: SILENT_LOGGER
          })
        }
      }
    )
  })
})
