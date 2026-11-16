import type { Chat, PostableCard, PostableMarkdown } from 'chat'
import { AsyncQueuer } from '@tanstack/pacer'

export const POST_INTERVAL_MS = 1_000

export type ChatIdentity = { name: string; iconUrl?: string }

export type ChatMessage = PostableMarkdown | PostableCard

export type ChatTarget = { threadId: string } | { channelId: string }

export type PostedMessage = { threadId: string; messageId: string }

export type SessionStatus = 'processing' | 'active' | 'suspended' | 'closed'

export type ChatPost = {
  target: ChatTarget
  message: ChatMessage
  identity?: ChatIdentity
}

export type ChatEditParams = {
  threadId: string
  messageId: string
  message: ChatMessage
}

export type IdentityPost = ChatPost & { identity: ChatIdentity }

export type PlatformExtras = {
  postAs?: (post: IdentityPost) => Promise<PostedMessage>
  setStatus?: (threadId: string, status: SessionStatus) => Promise<void>
}

type QueuedCall = () => Promise<void>

type CreateChatSurfaceParams = {
  chat: Chat
  extras?: PlatformExtras
}

export function createChatSurface({
  chat,
  extras = {}
}: CreateChatSurfaceParams) {
  const queues = new Map<string, AsyncQueuer<QueuedCall>>()

  const queueOf = (channelId: string) => {
    const known = queues.get(channelId)

    if (known !== undefined) {
      return known
    }

    const queue = new AsyncQueuer<QueuedCall>(
      async (call) => {
        await call()
      },
      { wait: POST_INTERVAL_MS }
    )
    queues.set(channelId, queue)

    return queue
  }

  const paced = <Result>(channelId: string, call: () => Promise<Result>) => {
    const done = Promise.withResolvers<Result>()
    queueOf(channelId).addItem(async () => {
      try {
        done.resolve(await call())
      } catch (error) {
        done.reject(error)
      }
    })

    return done.promise
  }

  const channelOf = (target: ChatTarget) => {
    return 'channelId' in target
      ? target.channelId
      : chat.thread(target.threadId).channelId
  }

  const postPlainly = async ({ target, message }: ChatPost) => {
    const sent =
      'channelId' in target
        ? await chat.channel(target.channelId).post(message)
        : await chat.thread(target.threadId).post(message)

    return { threadId: sent.threadId, messageId: sent.id }
  }

  const post = (chatPost: ChatPost): Promise<PostedMessage> => {
    const { identity } = chatPost
    const { postAs } = extras

    return paced(channelOf(chatPost.target), () => {
      return identity === undefined || postAs === undefined
        ? postPlainly(chatPost)
        : postAs({ ...chatPost, identity })
    })
  }

  const edit = ({ threadId, messageId, message }: ChatEditParams) => {
    const thread = chat.thread(threadId)

    return paced(thread.channelId, async () => {
      await thread.adapter.editMessage(threadId, messageId, message)
    })
  }

  const mention = (threadId: string, userId: string) => {
    return chat.thread(threadId).mentionUser(userId)
  }

  const subscribe = async (threadId: string) => {
    await chat.thread(threadId).subscribe()
  }

  const setStatus = async (threadId: string, status: SessionStatus) => {
    await extras.setStatus?.(threadId, status)
  }

  const threadChannelOf = (threadId: string) => {
    return chat.thread(threadId).channelId
  }

  return {
    post,
    edit,
    setStatus,
    subscribe,
    mention,
    channelOf: threadChannelOf
  }
}

export type ChatSurface = ReturnType<typeof createChatSurface>
