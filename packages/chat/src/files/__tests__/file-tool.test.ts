import { describe, expect, it, onTestFinished } from 'vitest'
import { defineHarness } from '@tanstack/ai-harness'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { fakeText, type FakeResponseStep } from '@tanstack/ai/testing'
import { createAgentHost, SILENT_HOST_LOGGER } from '@workcell/core/testing'
import { FILE_EVENT, fileOfEvent, type SentFile } from '#/files/file-event.ts'
import { chatFiles, SEND_FILE_TOOL } from '#/files/file-tool.ts'

const DECK = '<!doctype html><style>h1{color:green}</style><h1>Q4</h1>'

async function sendFile(input: Record<string, string>) {
  const toolResults: unknown[] = []
  const sentFiles: (SentFile | undefined)[] = []
  const call: FakeResponseStep = () => {
    return { toolCalls: [{ name: SEND_FILE_TOOL, input }] }
  }
  const answer: FakeResponseStep = ({ request }) => {
    toolResults.push(
      ...request.messages
        .filter(({ role }) => {
          return role === 'tool'
        })
        .map(({ content }) => {
          return content
        })
    )

    return { text: 'The deck is in the thread.' }
  }
  const model = fakeText()
  model.setResponses([call, answer])
  const harness = defineHarness({
    name: 'test/files',
    adapter: model,
    plugins: () => {
      return [chatFiles()]
    }
  })
  const host = createAgentHost({
    persistence: memoryPersistence(),
    logger: SILENT_HOST_LOGGER
  })
  onTestFinished(async () => {
    await host.close()
  })
  const session = await host.open(harness, { threadId: 'files-1' })
  session.onEvent('CUSTOM', ({ event }) => {
    if (event.name === FILE_EVENT) {
      sentFiles.push(fileOfEvent(event.value))
    }
  })

  await session.send('Make me a deck of the quarter.')
  await session.close()

  return { toolResults, sentFiles }
}

describe('the send_file tool', () => {
  it('hands the file to the chat and tells the model it is sent', async () => {
    const { toolResults, sentFiles } = await sendFile({
      name: 'deck.html',
      content: DECK
    })

    expect(sentFiles).toStrictEqual([{ name: 'deck.html', content: DECK }])
    expect(toolResults).toStrictEqual([
      expect.stringContaining('deck.html is sent in the thread.')
    ])
  })

  it('refuses a name with a folder or with no extension', async () => {
    const withFolder = await sendFile({ name: '../deck.html', content: DECK })
    const withNoExtension = await sendFile({ name: 'deck', content: DECK })

    expect([...withFolder.sentFiles, ...withNoExtension.sentFiles]).toStrictEqual(
      []
    )
  })
})
