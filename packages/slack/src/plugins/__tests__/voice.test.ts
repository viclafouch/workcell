import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { defineHarness } from '@tanstack/ai-harness'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { fakeText, type FakeResponseStep } from '@tanstack/ai/testing'
import { createAgentHost, SILENT_HOST_LOGGER } from '@workcell/core/testing'
import { slackVoice } from '#/plugins/voice.ts'

const FIRST_VOICE = 'Answer with ok.'

const EDITED_VOICE = 'Answer with yep.'

async function voiceFile() {
  const folder = await mkdtemp(join(tmpdir(), 'slack-voice-'))
  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true })
  })
  const file = join(folder, 'VOICE.md')
  await writeFile(file, FIRST_VOICE)

  return file
}

describe('the voice of the Slack agents', () => {
  it('reads the voice file again on each turn, so an edit applies from the next turn with no restart', async () => {
    const file = await voiceFile()
    const systemPrompts: unknown[] = []
    const answer: FakeResponseStep = ({ request }) => {
      systemPrompts.push(request.systemPrompts)

      return { text: 'ok' }
    }
    const model = fakeText()
    model.setResponses([answer, answer])
    const harness = defineHarness({
      name: 'test/voice',
      adapter: model,
      plugins: () => {
        return [slackVoice({ file })]
      }
    })
    const host = createAgentHost({
      persistence: memoryPersistence(),
      logger: SILENT_HOST_LOGGER
    })
    onTestFinished(async () => {
      await host.close()
    })
    const session = await host.open(harness, { threadId: 'voice-1' })

    await session.send('Is the PR merged?')
    await writeFile(file, EDITED_VOICE)
    await session.send('And the CI?')
    await session.close()

    expect(systemPrompts).toStrictEqual([[FIRST_VOICE], [EDITED_VOICE]])
  })
})
