import { describe, expect, it } from 'vitest'
import { createHarnessHost, defineHarness } from '@tanstack/ai-harness'
import { mediaIdOf, mediaPart } from '@tanstack/ai-harness/media'
import { fakeText } from '@tanstack/ai/testing'
import { createHarnessPersistence } from '#/store/harness-persistence.ts'
import {
  openTestDatabase,
  createMigratedDatabase
} from '#/testing/test-database.ts'

const SILENT_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
}

const HARNESS_NAME = 'workcell/durable-host-test'

async function openAgentHost(url: string, replies: string[]) {
  const database = openTestDatabase(url)
  const model = fakeText()
  model.setResponses(
    replies.map((text) => {
      return { text }
    })
  )
  const host = createHarnessHost({
    persistence: createHarnessPersistence({ database, logger: SILENT_LOGGER }),
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

function firstMediaIdOf(content: unknown) {
  const parts: unknown[] = Array.isArray(content) ? content : []
  const ids = parts.flatMap((part) => {
    return mediaIdOf(part) ?? []
  })

  return ids[0] ?? ''
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

  it('keeps a file of a message across a restart', async () => {
    const url = await createMigratedDatabase()
    const bytes = new TextEncoder().encode('image bytes')
    {
      await using first = await openAgentHost(url, ['A mockup.'])
      await using session = await first.open('file-restart')
      const record = await session.putMedia({
        body: bytes,
        mimeType: 'image/png',
        name: 'mockup.png'
      })
      await session.send([
        { type: 'text', content: 'What is this?' },
        mediaPart(record)
      ])
    }

    await using second = await openAgentHost(url, [])
    await using reopened = await second.open('file-restart')
    const [question] = await reopened.transcript()

    expect(
      await reopened.loadMedia({ id: firstMediaIdOf(question?.content) })
    ).toStrictEqual(bytes)
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
})
