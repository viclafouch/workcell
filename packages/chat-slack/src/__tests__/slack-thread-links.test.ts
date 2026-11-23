import { ConsoleLogger } from 'chat'
import { describe, expect, it } from 'vitest'
import { createSlackAdapter } from '@chat-adapter/slack'
import { slackThreadLinks } from '#/slack-thread-links.ts'

const WORKSPACE_URL = 'https://acme.slack.com/'

const threadLink = slackThreadLinks({
  adapter: createSlackAdapter({
    botToken: 'xoxb-test-bot-token',
    signingSecret: 'test-signing-secret',
    logger: new ConsoleLogger('silent')
  }),
  workspaceUrl: WORKSPACE_URL
})

describe('the Slack link of a thread', () => {
  it('links the chat thread of a worker', () => {
    expect(
      threadLink({
        threadId: 'worker-7',
        metadata: { chatThreadId: 'slack:C0TEST:1795448000.123456' }
      })
    ).toBe('https://acme.slack.com/archives/C0TEST/p1795448000123456')
  })

  it('links the thread of the bot', () => {
    expect(
      threadLink({ threadId: 'slack:C0TEST:1795448000.000100', metadata: null })
    ).toBe('https://acme.slack.com/archives/C0TEST/p1795448000000100')
  })

  it('gives no link to a thread outside Slack', () => {
    expect(threadLink({ threadId: 'worker-8', metadata: null })).toBeUndefined()
  })
})
