import type { Adapter, Author, Message, UserInfo } from 'chat'
import { chatInputId } from '#/connection/chat-input-id.ts'

const PAGE_SIZE = 100

const MOST_MESSAGES = 1000

export type ChatPerson = {
  userId: string
  name: string
  avatarUrl?: string
}

export type ChatThreadMessage = {
  inputId: string
  authorId: string
  sentAt: number
  isMe: boolean
  text: string
}

export type ChatThreadContext = {
  place: { name?: string; isDM: boolean; isPrivate: boolean }
  people: ChatPerson[]
  messages: ChatThreadMessage[]
}

type PersonOfParams = Pick<
  Author | UserInfo,
  'userId' | 'fullName' | 'userName'
>

function personOf({ userId, fullName, userName }: PersonOfParams): ChatPerson {
  return { userId, name: fullName || userName }
}

export function chatThreadContexts(adapter: Adapter) {
  const users = new Map<string, Promise<UserInfo | null>>()
  const readings = new Map<string, Promise<ChatThreadContext>>()

  const userOf = async (userId: string) => {
    const known = users.get(userId)

    if (known !== undefined) {
      return known
    }

    const user = (async () => {
      try {
        return (await adapter.getUser?.(userId)) ?? null
      } catch {
        return null
      }
    })()
    users.set(userId, user)

    if ((await user) === null) {
      users.delete(userId)
    }

    return user
  }

  const withAvatar = async (person: ChatPerson): Promise<ChatPerson> => {
    const user = await userOf(person.userId)

    return user?.avatarUrl === undefined
      ? person
      : { ...person, avatarUrl: user.avatarUrl }
  }

  const historyOf = async (
    threadId: string,
    cursor?: string,
    gathered: readonly Message[] = []
  ): Promise<Message[]> => {
    const page = await adapter.fetchMessages(threadId, {
      direction: 'forward',
      limit: PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor })
    })
    const messages = [...gathered, ...page.messages]

    if (page.nextCursor === undefined || messages.length >= MOST_MESSAGES) {
      return messages
    }

    return historyOf(threadId, page.nextCursor, messages)
  }

  const bot = async () => {
    if (adapter.botUserId === undefined) {
      return null
    }

    const user = await userOf(adapter.botUserId)

    return user === null ? null : withAvatar(personOf(user))
  }

  const read = async (threadId: string): Promise<ChatThreadContext> => {
    const [thread, history] = await Promise.all([
      adapter.fetchThread(threadId),
      historyOf(threadId)
    ])
    const authors = new Map(
      history.map(({ author }) => {
        return [author.userId, personOf(author)]
      })
    )

    return {
      place: {
        ...(thread.channelName === undefined
          ? {}
          : { name: thread.channelName }),
        isDM: thread.isDM ?? false,
        isPrivate: thread.channelVisibility === 'private'
      },
      people: await Promise.all([...authors.values()].map(withAvatar)),
      messages: history.map(({ id, author, metadata, text }) => {
        return {
          inputId: chatInputId(threadId, id),
          authorId: author.userId,
          sentAt: metadata.dateSent.getTime(),
          isMe: author.isMe,
          text
        }
      })
    }
  }

  const readOnce = async (threadId: string) => {
    try {
      return await read(threadId)
    } finally {
      readings.delete(threadId)
    }
  }

  const describe = (threadId: string) => {
    const reading = readings.get(threadId) ?? readOnce(threadId)
    readings.set(threadId, reading)

    return reading
  }

  return { bot, describe }
}
