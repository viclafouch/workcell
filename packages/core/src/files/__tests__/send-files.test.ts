import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { defineHarness } from '@tanstack/ai-harness'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { fakeText } from '@tanstack/ai/testing'
import {
  SEND_FILE_TOOL,
  SENT_FILE_EVENT,
  SENT_FILE_MAX_BYTES,
  sendFiles,
  sentFileOfEvent,
  type ReadAgentFile,
  type SentFile
} from '#/files/send-files.ts'
import { createAgentHost } from '#/host/agent-host.ts'
import { SILENT_HOST_LOGGER } from '#/testing/test-doubles.ts'

const SECRET_VALUE = 'sk-live-secret-value'

const CHART_BYTES = new TextEncoder().encode('chart bytes')

type SendFileParams = {
  input: Record<string, string>
  readFile?: ReadAgentFile
}

async function sendFile({ input, readFile = vi.fn() }: SendFileParams) {
  const stored: { threadId: string; name: string; bytes: Uint8Array }[] = []
  const events: (SentFile | undefined)[] = []
  const results: string[] = []
  const model = fakeText()
  model.setResponses([
    { toolCalls: [{ name: SEND_FILE_TOOL, input }] },
    { text: 'The file is in the thread.' }
  ])
  const harness = defineHarness({
    name: 'test/send-files',
    adapter: model,
    plugins: () => {
      return [
        sendFiles({
          sentFiles: {
            put: async (file) => {
              stored.push(file)

              return `sent-files/${file.threadId}/${stored.length}`
            }
          },
          readFile,
          secretValues: [SECRET_VALUE]
        })
      ]
    }
  })
  const host = createAgentHost({
    persistence: memoryPersistence(),
    logger: SILENT_HOST_LOGGER
  })
  onTestFinished(async () => {
    await host.close()
  })
  const session = await host.open(harness, { threadId: 'thread-1' })
  session.onEvent('CUSTOM', ({ event }) => {
    if (event.name === SENT_FILE_EVENT) {
      events.push(sentFileOfEvent(event.value))
    }
  })
  session.onEvent('TOOL_CALL_RESULT', ({ event }) => {
    results.push(JSON.stringify(event.content))
  })

  await session.send('Send me the file.')
  await session.close()

  return { stored, events, result: results.join('\n'), readFile }
}

describe('the send_file tool', () => {
  it('keeps a file written as text, and hands its key to the chat', async () => {
    const { stored, events, result } = await sendFile({
      input: { name: 'deck.html', content: '<h1>Q4</h1>' }
    })

    expect(stored).toStrictEqual([
      {
        threadId: 'thread-1',
        name: 'deck.html',
        bytes: new TextEncoder().encode('<h1>Q4</h1>')
      }
    ])
    expect(events).toStrictEqual([
      { key: 'sent-files/thread-1/1', name: 'deck.html' }
    ])
    expect(result).toContain('deck.html is sent to the person.')
  })

  it('reads a file of the workspace of its thread, by its path', async () => {
    const readFile = vi.fn<ReadAgentFile>(async () => {
      return CHART_BYTES
    })
    const { stored } = await sendFile({
      input: { name: 'chart.png', path: 'out/chart.png' },
      readFile
    })

    expect(readFile).toHaveBeenCalledWith('thread-1', 'out/chart.png')
    expect(stored).toMatchObject([{ name: 'chart.png', bytes: CHART_BYTES }])
  })

  it('refuses a file that holds a secret value of the host', async () => {
    const { stored, events, result } = await sendFile({
      input: { name: 'env.txt', content: `TOKEN=${SECRET_VALUE}` }
    })

    expect([...stored, ...events]).toStrictEqual([])
    expect(result).toContain('holds a secret value of the host')
    expect(result).not.toContain(SECRET_VALUE)
  })

  it('refuses a file over the size limit', async () => {
    const { stored, result } = await sendFile({
      input: { name: 'video.mp4', path: 'out/video.mp4' },
      readFile: async () => {
        return new Uint8Array(SENT_FILE_MAX_BYTES + 1)
      }
    })

    expect(stored).toStrictEqual([])
    expect(result).toContain('bigger than the limit of 50 MB')
  })

  it('refuses a call with both content and a path, or with neither', async () => {
    const both = await sendFile({
      input: { name: 'a.md', content: '# A', path: 'a.md' }
    })
    const neither = await sendFile({ input: { name: 'a.md' } })

    expect([...both.stored, ...neither.stored]).toStrictEqual([])
    expect(both.readFile).not.toHaveBeenCalled()
  })
})
