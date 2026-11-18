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

const slackAnswer = { givesTimestamp: true, postsBeforeFileIsReady: 0 }

const TIMESTAMP = { ts: '2.0001' }

const UPLOAD_URL = 'https://files.slack.com/upload/v1/F_FILE'

const UPLOAD_ANSWER = { ok: true, upload_url: UPLOAD_URL, file_id: 'F_FILE' }

const network = setupServer(
  http.post('https://slack.com/api/:method', async ({ request, params }) => {
    const { token: _token, ...body } = formBodySchema.parse(
      Object.fromEntries(new URLSearchParams(await request.text()))
    )
    const method = z.string().parse(params.method)
    calls.push({ method, body })

    if (method === 'files.getUploadURLExternal') {
      return HttpResponse.json(UPLOAD_ANSWER)
    }

    if (method === 'chat.postMessage' && slackAnswer.postsBeforeFileIsReady > 0) {
      slackAnswer.postsBeforeFileIsReady -= 1

      return HttpResponse.json({ ok: false, error: 'invalid_blocks' })
    }

    return HttpResponse.json(
      slackAnswer.givesTimestamp ? { ok: true, ...TIMESTAMP } : { ok: true }
    )
  }),
  http.post(UPLOAD_URL, async ({ request }) => {
    calls.push({ method: 'upload', body: { bytes: await request.text() } })

    return new HttpResponse('OK')
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
    slackAnswer.postsBeforeFileIsReady = 0
  })

  afterAll(() => {
    network.close()
  })

  it('posts an image in a message of the identity once Slack has it ready', async () => {
    slackAnswer.postsBeforeFileIsReady = 1
    const postAs = requirePostAs()

    await postAs({
      target: { threadId: 'slack:C_WORKERS:1.0001' },
      identity: ALPHA,
      message: {
        markdown: '',
        files: [{ filename: 'chart.png', data: Buffer.from('png bytes') }]
      }
    })
    const imagePost = {
      method: 'chat.postMessage',
      body: {
        channel: 'C_WORKERS',
        thread_ts: '1.0001',
        text: 'chart.png',
        blocks: JSON.stringify([
          { type: 'image', slack_file: { id: 'F_FILE' }, alt_text: 'chart.png' }
        ]),
        username: ALPHA.name,
        icon_url: ALPHA.iconUrl
      }
    }

    expect(calls).toStrictEqual([
      {
        method: 'files.getUploadURLExternal',
        body: { filename: 'chart.png', length: '9' }
      },
      { method: 'upload', body: { bytes: 'png bytes' } },
      {
        method: 'files.completeUploadExternal',
        body: { files: JSON.stringify([{ id: 'F_FILE', title: 'chart.png' }]) }
      },
      imagePost,
      imagePost
    ])
  })

  it('shares another file in the thread with a caption that names the identity', async () => {
    const postAs = requirePostAs()

    await postAs({
      target: { threadId: 'slack:C_WORKERS:1.0001' },
      identity: ALPHA,
      message: {
        markdown: '',
        files: [{ filename: 'r2.mp4', data: Buffer.from('video bytes') }]
      }
    })

    expect(calls).toStrictEqual([
      {
        method: 'files.getUploadURLExternal',
        body: { filename: 'r2.mp4', length: '11' }
      },
      { method: 'upload', body: { bytes: 'video bytes' } },
      {
        method: 'files.completeUploadExternal',
        body: {
          files: JSON.stringify([{ id: 'F_FILE', title: 'r2.mp4' }]),
          channel_id: 'C_WORKERS',
          thread_ts: '1.0001',
          initial_comment: 'From Alpha'
        }
      }
    ])
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
