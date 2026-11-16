import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openSlackChat, useSlackApi } from '#/__tests__/test-doubles.ts'
import {
  createChatSurface,
  POST_INTERVAL_MS,
  type IdentityPost,
  type PlatformExtras,
  type SessionStatus
} from '#/connection/chat-surface.ts'

const THREAD = 'slack:C_TEST:1.0001'

const slackApi = useSlackApi()

function sent() {
  return slackApi.calls.map(({ method, body }) => {
    const text = body.markdown_text ?? body.text
    const place =
      method === 'chat.update' ? body.ts : (body.thread_ts ?? 'root')

    return `${method} ${body.channel} ${place}: ${text}`
  })
}

describe('createChatSurface', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('posts in one channel at most once a second, in order', async () => {
    await using slackChat = openSlackChat()
    const surface = createChatSurface({ chat: slackChat.chat })
    const post = (markdown: string) => {
      return surface.post({
        target: { threadId: THREAD },
        message: { markdown }
      })
    }

    const allPosted = Promise.all([post('one'), post('two'), post('three')])
    await vi.advanceTimersByTimeAsync(POST_INTERVAL_MS - 1)

    expect(sent()).toStrictEqual(['chat.postMessage C_TEST 1.0001: one'])

    await vi.advanceTimersByTimeAsync(1)

    expect(sent()).toStrictEqual([
      'chat.postMessage C_TEST 1.0001: one',
      'chat.postMessage C_TEST 1.0001: two'
    ])

    await vi.advanceTimersByTimeAsync(POST_INTERVAL_MS)
    await allPosted

    expect(sent()).toStrictEqual([
      'chat.postMessage C_TEST 1.0001: one',
      'chat.postMessage C_TEST 1.0001: two',
      'chat.postMessage C_TEST 1.0001: three'
    ])
  })

  it('posts in two channels without waiting on each other', async () => {
    await using slackChat = openSlackChat()
    const surface = createChatSurface({ chat: slackChat.chat })

    await Promise.all([
      surface.post({
        target: { threadId: 'slack:C_ONE:1.0001' },
        message: { markdown: 'one' }
      }),
      surface.post({
        target: { channelId: 'slack:C_TWO' },
        message: { markdown: 'two' }
      })
    ])

    expect(sent().toSorted()).toStrictEqual([
      'chat.postMessage C_ONE 1.0001: one',
      'chat.postMessage C_TWO root: two'
    ])
  })

  it('opens a thread with a channel post, then edits it in the same queue as the posts of its channel', async () => {
    await using slackChat = openSlackChat()
    const surface = createChatSurface({ chat: slackChat.chat })

    const opened = surface.post({
      target: { channelId: 'slack:C_TEST' },
      message: { markdown: 'I take TASK-7' }
    })
    const edited = opened.then(({ threadId, messageId }) => {
      return surface.edit({
        threadId,
        messageId,
        message: { markdown: 'I take TASK-7, branch task-7' }
      })
    })
    await vi.advanceTimersByTimeAsync(POST_INTERVAL_MS - 1)

    expect(await opened).toStrictEqual({
      threadId: 'slack:C_TEST:1.0001',
      messageId: '1.0001'
    })
    expect(sent()).toStrictEqual([
      'chat.postMessage C_TEST root: I take TASK-7'
    ])

    await vi.advanceTimersByTimeAsync(1)
    await edited

    expect(sent()).toStrictEqual([
      'chat.postMessage C_TEST root: I take TASK-7',
      'chat.update C_TEST 1.0001: I take TASK-7, branch task-7'
    ])
  })

  it('rejects the post that the platform refuses, and goes on with the next one', async () => {
    slackApi.answer('chat.postMessage', {
      ok: false,
      error: 'channel_not_found'
    })
    await using slackChat = openSlackChat()
    const surface = createChatSurface({ chat: slackChat.chat })

    const lost = surface.post({
      target: { threadId: 'slack:C_GONE:1.0001' },
      message: { markdown: 'lost' }
    })
    const next = surface.post({
      target: { threadId: 'slack:C_GONE:1.0001' },
      message: { markdown: 'next' }
    })
    const outcomes = Promise.allSettled([lost, next])
    await vi.advanceTimersByTimeAsync(POST_INTERVAL_MS)

    await outcomes
    await expect(lost).rejects.toThrow('channel_not_found')
    await expect(next).rejects.toThrow('channel_not_found')
    expect(sent()).toStrictEqual([
      'chat.postMessage C_GONE 1.0001: lost',
      'chat.postMessage C_GONE 1.0001: next'
    ])
  })

  it('posts under an identity through the platform, and as the app with no identity or no platform post', async () => {
    const identityPosts: IdentityPost[] = []
    const extras: PlatformExtras = {
      postAs: async (post) => {
        identityPosts.push(post)

        return { threadId: THREAD, messageId: '9.0001' }
      }
    }
    await using slackChat = openSlackChat()
    const surface = createChatSurface({ chat: slackChat.chat, extras })
    const plainSurface = createChatSurface({ chat: slackChat.chat })
    const alpha = {
      name: 'Alpha',
      iconUrl: 'https://images.example.com/alpha.png'
    }

    const asAlpha = await surface.post({
      target: { threadId: THREAD },
      identity: alpha,
      message: { markdown: 'I take TASK-7' }
    })
    await plainSurface.post({
      target: { threadId: 'slack:C_OTHER:1.0001' },
      identity: alpha,
      message: { markdown: 'as the app' }
    })
    await surface.post({
      target: { threadId: 'slack:C_THIRD:1.0001' },
      message: { markdown: 'as the app too' }
    })

    expect(asAlpha).toStrictEqual({ threadId: THREAD, messageId: '9.0001' })
    expect(identityPosts).toStrictEqual([
      {
        target: { threadId: THREAD },
        identity: alpha,
        message: { markdown: 'I take TASK-7' }
      }
    ])
    expect(sent()).toStrictEqual([
      'chat.postMessage C_OTHER 1.0001: as the app',
      'chat.postMessage C_THIRD 1.0001: as the app too'
    ])
  })

  it('sets the session status through the platform, and does nothing on a platform with no status', async () => {
    const statuses: string[] = []
    await using slackChat = openSlackChat()
    const surface = createChatSurface({
      chat: slackChat.chat,
      extras: {
        setStatus: async (threadId: string, status: SessionStatus) => {
          statuses.push(`${threadId} ${status}`)
        }
      }
    })

    await surface.setStatus(THREAD, 'suspended')
    await createChatSurface({ chat: slackChat.chat }).setStatus(
      THREAD,
      'closed'
    )

    expect(statuses).toStrictEqual([`${THREAD} suspended`])
    expect(sent()).toStrictEqual([])
  })

  it('mentions a person and names the channel of a thread in the words of the platform', async () => {
    await using slackChat = openSlackChat()
    const surface = createChatSurface({ chat: slackChat.chat })

    expect(surface.mention(THREAD, 'U_STARTER')).toBe('<@U_STARTER>')
    expect(surface.channelOf(THREAD)).toBe('slack:C_TEST')
  })
})
