import { ConsoleLogger, type CardElement } from 'chat'
import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createSlackAdapter } from '@chat-adapter/slack'
import { slackPlatform } from '#/slack-platform.ts'

const ALPHA = { name: 'Alpha', iconUrl: 'https://images.example.com/alpha.png' }

const PLAN_CARD: CardElement = {
  type: 'card',
  title: 'Steps',
  children: [{ type: 'text', content: '→ Read the task' }]
}

const formBodySchema = z.record(z.string(), z.string())

type SlackCall = { method: string; body: Record<string, string> }

const calls: SlackCall[] = []

const slackAnswer = { givesTimestamp: true }

const TIMESTAMP = { ts: '2.0001' }

const network = setupServer(
  http.post('https://slack.com/api/:method', async ({ request, params }) => {
    const { token: _token, ...body } = formBodySchema.parse(
      Object.fromEntries(new URLSearchParams(await request.text()))
    )
    calls.push({ method: z.string().parse(params.method), body })

    return HttpResponse.json(
      slackAnswer.givesTimestamp ? { ok: true, ...TIMESTAMP } : { ok: true }
    )
  })
)

function openPlatform() {
  return slackPlatform(
    createSlackAdapter({
      botToken: 'xoxb-test-bot-token',
      signingSecret: 'test-signing-secret',
      logger: new ConsoleLogger('silent')
    })
  )
}

function requirePostAs() {
  const { postAs } = openPlatform()

  if (postAs === undefined) {
    throw new Error('The Slack platform posts under no identity.')
  }

  return postAs
}

describe('slackPlatform', () => {
  beforeAll(() => {
    network.listen({ onUnhandledFrame: 'error' })
  })

  beforeEach(() => {
    calls.length = 0
    slackAnswer.givesTimestamp = true
  })

  afterAll(() => {
    network.close()
  })

  it('posts in a thread under the name and the image of an identity, with no link preview', async () => {
    const postAs = requirePostAs()

    const sent = await postAs({
      target: { threadId: 'slack:C_WORKERS:1.0001' },
      identity: ALPHA,
      message: { markdown: 'Pull request opened.' }
    })

    expect(sent).toStrictEqual({
      threadId: 'slack:C_WORKERS:1.0001',
      messageId: '2.0001'
    })
    expect(calls).toStrictEqual([
      {
        method: 'chat.postMessage',
        body: {
          channel: 'C_WORKERS',
          thread_ts: '1.0001',
          markdown_text: 'Pull request opened.',
          username: 'Alpha',
          icon_url: ALPHA.iconUrl,
          unfurl_links: 'false',
          unfurl_media: 'false'
        }
      }
    ])
  })

  it('opens a thread with a post in a channel, and names the thread after its first message', async () => {
    const postAs = requirePostAs()

    const sent = await postAs({
      target: { channelId: 'slack:C_WORKERS' },
      identity: { name: 'Bravo' },
      message: { markdown: 'I take TASK-7' }
    })

    expect(sent).toStrictEqual({
      threadId: 'slack:C_WORKERS:2.0001',
      messageId: '2.0001'
    })
    expect(calls).toMatchObject([
      {
        method: 'chat.postMessage',
        body: { channel: 'C_WORKERS', username: 'Bravo' }
      }
    ])
    expect(calls[0]?.body).not.toHaveProperty('thread_ts')
    expect(calls[0]?.body).not.toHaveProperty('icon_url')
  })

  it('posts a card as Block Kit, with its fallback text or the text of the card', async () => {
    const postAs = requirePostAs()

    await postAs({
      target: { threadId: 'slack:C_WORKERS:1.0001' },
      identity: ALPHA,
      message: { card: PLAN_CARD, fallbackText: 'Steps: 0 of 1 done.' }
    })
    await postAs({
      target: { threadId: 'slack:C_WORKERS:1.0001' },
      identity: ALPHA,
      message: { card: PLAN_CARD }
    })
    const [withFallback, withCardText] = calls

    expect(withFallback?.body.text).toBe('Steps: 0 of 1 done.')
    expect(withCardText?.body.text).toContain('→ Read the task')
    expect(withFallback?.body.blocks).toBe(withCardText?.body.blocks)
    expect(
      JSON.parse(z.string().parse(withFallback?.body.blocks))
    ).toMatchObject([
      { type: 'header', text: { text: 'Steps' } },
      { type: 'section', text: { text: '→ Read the task' } }
    ])
  })

  it('fails a post that Slack gives no timestamp', async () => {
    const postAs = requirePostAs()
    slackAnswer.givesTimestamp = false

    await expect(
      postAs({
        target: { channelId: 'slack:C_WORKERS' },
        identity: ALPHA,
        message: { markdown: 'lost' }
      })
    ).rejects.toThrow('Slack gave no timestamp to the post in C_WORKERS.')
  })

  it('sets the status of the agent session of a thread', async () => {
    const { setStatus } = openPlatform()

    await setStatus?.('slack:C_WORKERS:1.0001', 'suspended')

    expect(calls).toStrictEqual([
      {
        method: 'agents.sessions.setStatus',
        body: {
          channel_id: 'C_WORKERS',
          thread_ts: '1.0001',
          status: 'suspended'
        }
      }
    ])
  })

  it('names the identity of a thread in the status of its agent session', async () => {
    const { setStatus } = openPlatform()

    await setStatus?.('slack:C_WORKERS:1.0001', 'processing', ALPHA)
    await setStatus?.('slack:C_WORKERS:1.0001', 'active', { name: 'Bravo' })

    expect(calls).toStrictEqual([
      {
        method: 'agents.sessions.setStatus',
        body: {
          channel_id: 'C_WORKERS',
          thread_ts: '1.0001',
          status: 'processing',
          username: 'Alpha',
          icon_url: ALPHA.iconUrl
        }
      },
      {
        method: 'agents.sessions.setStatus',
        body: {
          channel_id: 'C_WORKERS',
          thread_ts: '1.0001',
          status: 'active',
          username: 'Bravo'
        }
      }
    ])
  })

  it('cuts a status line to the 50 characters that Slack shows', async () => {
    const { setStatusLine } = openPlatform()

    await setStatusLine?.(
      'slack:C_WORKERS:1.0001',
      'gets its sandbox ready, which can take a few minutes',
      ALPHA
    )

    expect(calls).toMatchObject([
      {
        method: 'assistant.threads.setStatus',
        body: {
          status: 'gets its sandbox ready, which can take a few minu…',
          loading_messages:
            '["gets its sandbox ready, which can take a few minu…"]'
        }
      }
    ])
  })

  it('shows a status line under the identity of a thread, and clears it with no loading message', async () => {
    const { setStatusLine } = openPlatform()

    await setStatusLine?.('slack:C_WORKERS:1.0001', 'reads your message', ALPHA)
    await setStatusLine?.('slack:C_WORKERS:1.0001', '')

    expect(calls).toStrictEqual([
      {
        method: 'assistant.threads.setStatus',
        body: {
          channel_id: 'C_WORKERS',
          thread_ts: '1.0001',
          status: 'reads your message',
          loading_messages: '["reads your message"]',
          username: 'Alpha',
          icon_url: ALPHA.iconUrl
        }
      },
      {
        method: 'assistant.threads.setStatus',
        body: { channel_id: 'C_WORKERS', thread_ts: '1.0001', status: '' }
      }
    ])
  })
})
