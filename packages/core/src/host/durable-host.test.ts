import { describe, expect, it } from 'vitest'
import { defineHarness } from '@tanstack/ai-harness'
import { fakeText } from '@tanstack/ai/testing'
import type { Database } from '#core/store/database'
import { createHarnessPersistence } from '#core/store/harness-persistence'
import {
  openTestDatabase,
  createMigratedDatabase
} from '#core/store/test-database'
import { createAgentHost } from './agent-host.ts'

const SILENT_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
}

const HARNESS_NAME = 'workcell/durable-host-test'

const TOOL_OUTPUT_BYTES = 10_000

const TOOL_OUTPUT = 'x'.repeat(TOOL_OUTPUT_BYTES)

const TOOL_OUTPUTS = 30

const SNAPSHOT_AFTER_BYTES = 100_000

const KEPT_BYTES_LIMIT = SNAPSHOT_AFTER_BYTES + 2 * TOOL_OUTPUT.length

async function openAgentHost(url: string, replies: string[]) {
  const database = openTestDatabase(url)
  const model = fakeText()
  model.setResponses(
    replies.map((text) => {
      return { text }
    })
  )
  const host = createAgentHost({
    persistence: createHarnessPersistence({ database, logger: SILENT_LOGGER }),
    log: { saveSnapshotAfter: { bytes: SNAPSHOT_AFTER_BYTES } },
    logger: SILENT_LOGGER
  })
  const harness = defineHarness({ name: HARNESS_NAME, adapter: model })

  return {
    database,
    open: async (threadId: string) => {
      return host.open(harness, { threadId })
    },
    [Symbol.asyncDispose]: async () => {
      await host.close()
      await database.close()
    }
  }
}

async function measureLog(database: Database) {
  const [log] = await database.query<{
    head: number
    first_seq: number
    kept_bytes: number
  }>(
    'measure the log',
    `SELECT o.head::int, o.first_seq::int,
       COALESCE(sum(length(r.record)), 0)::int AS kept_bytes
     FROM log_owner AS o
     LEFT JOIN log_records AS r USING (log_id)
     GROUP BY o.head, o.first_seq`
  )

  return {
    head: log?.head ?? 0,
    firstSeq: log?.first_seq ?? 1,
    keptBytes: log?.kept_bytes ?? 0
  }
}

describe('a host on Postgres', () => {
  it('reopens a thread after a restart with its transcript and its index entry', async () => {
    const url = await createMigratedDatabase()
    {
      await using first = await openAgentHost(url, ['Hi.'])
      await using session = await first.open('restart')
      await session.send('Hello')
    }

    await using second = await openAgentHost(url, [])
    await using reopened = await second.open('restart')

    expect(await reopened.transcript()).toMatchObject([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi.' }
    ])
    expect(await reopened.indexEntry()).toMatchObject({
      threadId: 'restart',
      harness: HARNESS_NAME
    })
  })

  it('reopens a thread that a stopped host still owns, from the log alone', async () => {
    const url = await createMigratedDatabase()
    await using stopped = await openAgentHost(url, ['Hi.'])
    await using session = await stopped.open('no-release')
    await session.send('Hello')

    await using next = await openAgentHost(url, [])
    await using reopened = await next.open('no-release')

    expect(await reopened.transcript()).toMatchObject([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi.' }
    ])
  })

  it('drops the log records that a snapshot holds, so the log stays bounded', async () => {
    const url = await createMigratedDatabase()
    await using agentHost = await openAgentHost(url, [])
    await using session = await agentHost.open('long-thread')
    const keptBytes: number[] = []

    for (let output = 1; output <= TOOL_OUTPUTS; output += 1) {
      // oxlint-disable-next-line no-await-in-loop -- the test measures the log after each append
      await session.appendRecords({
        records: [{ type: 'workcell.tool-output', output, text: TOOL_OUTPUT }]
      })
      // oxlint-disable-next-line no-await-in-loop -- the measure reads the log after this append
      const { keptBytes: kept } = await measureLog(agentHost.database)
      keptBytes.push(kept)
    }
    const log = await measureLog(agentHost.database)

    expect(TOOL_OUTPUTS * TOOL_OUTPUT.length).toBeGreaterThan(
      2 * KEPT_BYTES_LIMIT
    )
    expect(log.firstSeq).toBeGreaterThan(1)
    expect(log.firstSeq).toBeLessThanOrEqual(log.head + 1)
    expect(Math.max(...keptBytes)).toBeLessThan(KEPT_BYTES_LIMIT)
  })
})
