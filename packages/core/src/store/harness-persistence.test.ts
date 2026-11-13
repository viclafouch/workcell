import { randomUUIDv7 } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NO_OWNER_EPOCH } from '@tanstack/ai-persistence'
import { runPersistenceConformance } from '@tanstack/ai-persistence/testkit'
import type { Database } from './database.ts'
import { createHarnessPersistence } from './harness-persistence.ts'
import { createPostgresLogStore } from './log-store.ts'
import {
  openTestDatabase,
  SILENT_LOGGER,
  createMigratedDatabase
} from './test-database.ts'

const CHAT_AND_MEDIA_STORES = [
  'messages',
  'activities',
  'runs',
  'interrupts',
  'generationRuns',
  'artifacts',
  'blobs'
] as const

const TWIN_LISTEN_TIMEOUT_MS = 10_000

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

  runPersistenceConformance(
    'Postgres',
    () => {
      return createHarnessPersistence({ database, logger: SILENT_LOGGER })
    },
    {
      skip: [...CHAT_AND_MEDIA_STORES],
      twin: () => {
        return createHarnessPersistence({
          database: twinDatabase,
          logger: SILENT_LOGGER
        })
      }
    }
  )
})
