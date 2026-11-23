import { describe, expect, it } from 'vitest'
import { createHarnessHost, defineHarness } from '@tanstack/ai-harness'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { fakeText, type FakeResponseStep } from '@tanstack/ai/testing'
import { SILENT_HOST_LOGGER } from '@workcell/core/testing'
import { SLACK_FORMATTING, slackFormatting } from '#/slack-formatting.ts'

function promptText(prompt: string | { content: string }) {
  return typeof prompt === 'string' ? prompt : prompt.content
}

function recordSystemPrompts(systemPrompts: string[]): FakeResponseStep {
  return ({ request }) => {
    systemPrompts.push(...(request.systemPrompts ?? []).map(promptText))

    return { text: 'Done.' }
  }
}

describe('the Slack formatting', () => {
  it('tells the agent what Slack renders, and leaves the choice to each message', async () => {
    const systemPrompts: string[] = []
    const model = fakeText()
    model.setResponses([recordSystemPrompts(systemPrompts)])
    const host = createHarnessHost({
      persistence: memoryPersistence(),
      logger: SILENT_HOST_LOGGER
    })
    const agent = defineHarness({
      name: 'test/slack-formatting',
      adapter: model,
      plugins: () => {
        return [slackFormatting]
      }
    })
    const session = await host.open(agent, { threadId: 'slack-formatting' })

    await session.send('Hello.')
    await host.close()

    expect(systemPrompts).toStrictEqual([SLACK_FORMATTING])
  })
})
