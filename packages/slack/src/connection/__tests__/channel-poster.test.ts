import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  createChannelPoster,
  POST_INTERVAL_MS
} from '#/connection/channel-poster.ts'

const ORCHESTRATOR = {
  username: 'Orchestrator',
  icon: { url: 'https://images.example.com/orchestrator.png' }
}

const postSchema = z.object({
  channel: z.string(),
  thread_ts: z.string().optional(),
  markdown_text: z.string(),
  username: z.literal(ORCHESTRATOR.username),
  icon_url: z.literal(ORCHESTRATOR.icon.url),
  unfurl_links: z.literal(false),
  unfurl_media: z.literal(false)
})

const editSchema = z.object({
  channel: z.string(),
  ts: z.string(),
  text: z.string(),
  blocks: z.array(z.object({ type: z.string() }))
})

async function refused(): Promise<never> {
  throw new Error('An API error occurred: channel_not_found')
}

function recordPosts() {
  const posts: string[] = []
  const poster = createChannelPoster({
    chat: {
      postMessage: async (message) => {
        const { channel, markdown_text: text } = postSchema.parse(message)
        posts.push(`${channel} ${text}`)

        return { ok: true, ts: `${posts.length}.0001` }
      },
      update: async (message) => {
        const { channel, ts, text } = editSchema.parse(message)
        posts.push(`${channel} ${ts} edited: ${text}`)

        return { ok: true, ts }
      }
    }
  })

  const post = (
    thread: { channel: string; threadTs?: string },
    markdown: string
  ) => {
    return poster.post({ ...thread, markdown, identity: ORCHESTRATOR })
  }

  return { posts, post, edit: poster.edit }
}

describe('createChannelPoster', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('posts in one channel at most once a second, in order', async () => {
    const { posts, post } = recordPosts()
    const thread = { channel: 'C_TEST', threadTs: '1.0001' }

    const allPosted = Promise.all([
      post(thread, 'one'),
      post(thread, 'two'),
      post(thread, 'three')
    ])
    await vi.advanceTimersByTimeAsync(POST_INTERVAL_MS - 1)

    expect(posts).toStrictEqual(['C_TEST one'])

    await vi.advanceTimersByTimeAsync(1)

    expect(posts).toStrictEqual(['C_TEST one', 'C_TEST two'])

    await vi.advanceTimersByTimeAsync(POST_INTERVAL_MS)
    await allPosted

    expect(posts).toStrictEqual(['C_TEST one', 'C_TEST two', 'C_TEST three'])
  })

  it('posts in two channels without waiting on each other', async () => {
    const { posts, post } = recordPosts()

    await Promise.all([
      post({ channel: 'C_ONE', threadTs: '1.0001' }, 'one'),
      post({ channel: 'C_TWO', threadTs: '2.0001' }, 'two')
    ])

    expect(posts).toStrictEqual(['C_ONE one', 'C_TWO two'])
  })

  it('edits a message in the same queue as the posts of its channel, and gives each post its timestamp', async () => {
    const { posts, post, edit } = recordPosts()

    const done = Promise.all([
      post({ channel: 'C_TEST' }, 'root'),
      edit({
        channel: 'C_TEST',
        ts: '1.0001',
        text: 'Steps: 1 of 2 done.',
        blocks: [{ type: 'plan', title: 'Steps', tasks: [] }]
      })
    ])
    await vi.advanceTimersByTimeAsync(POST_INTERVAL_MS - 1)

    expect(posts).toStrictEqual(['C_TEST root'])

    await vi.advanceTimersByTimeAsync(1)
    const [rootTs] = await done

    expect(rootTs).toBe('1.0001')
    expect(posts).toStrictEqual([
      'C_TEST root',
      'C_TEST 1.0001 edited: Steps: 1 of 2 done.'
    ])
  })

  it('rejects the post that Slack refuses', async () => {
    const { post } = createChannelPoster({
      chat: { postMessage: refused, update: refused }
    })

    await expect(
      post({
        channel: 'C_GONE',
        threadTs: '1.0001',
        markdown: 'lost',
        identity: ORCHESTRATOR
      })
    ).rejects.toThrow('channel_not_found')
  })

  it('posts as the app, with its own name and picture, when it gets no identity', async () => {
    const sent: unknown[] = []
    const { post } = createChannelPoster({
      chat: {
        postMessage: async (message) => {
          sent.push(message)

          return { ok: true, ts: '1.0001' }
        },
        update: refused
      }
    })

    await post({ channel: 'C_TEST', markdown: 'done' })

    expect(sent[0]).not.toHaveProperty('username')
    expect(sent[0]).not.toHaveProperty('icon_url')
  })

  it('posts under an image avatar with its URL and no emoji', async () => {
    const sent: unknown[] = []
    const { post } = createChannelPoster({
      chat: {
        postMessage: async (message) => {
          sent.push(message)

          return { ok: true, ts: '1.0001' }
        },
        update: refused
      }
    })

    await post({
      channel: 'C_TEST',
      markdown: 'I take TASK-7',
      identity: {
        username: 'Alpha',
        icon: { url: 'https://images.example.com/alpha.png' }
      }
    })

    expect(sent).toStrictEqual([
      expect.objectContaining({
        username: 'Alpha',
        icon_url: 'https://images.example.com/alpha.png'
      })
    ])
    expect(sent[0]).not.toHaveProperty('icon_emoji')
  })
})
