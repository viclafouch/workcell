import { useQuery } from '@tanstack/react-query'
import { chatAdapterOf, chatInputOf } from '#/lib/chat-input.ts'
import type { PersonMessage } from '#/lib/chat-turns.ts'
import { getBrandQueryOpts } from '#/queries/brand.ts'
import {
  getChatMarksQueryOpts,
  getChatThreadQueryOpts
} from '#/queries/chat.ts'
import { listWorkerIdentitiesQueryOpts } from '#/queries/workers.ts'
import type {
  ChatThreadDetails,
  HarnessName
} from '#/server/console-context.ts'

export type SpeakerFallback = 'brand' | 'person' | 'worker'

export type ChatSpeaker = {
  fallback: SpeakerFallback
  name?: string
  avatarUrl?: string
}

export type PersonSpeaker = ChatSpeaker & { sentAt?: number }

type UseChatSpeakersParams = {
  harness: HarnessName
  chatThreadId: string | null
  agentName?: string
}

const indexThread = (details: ChatThreadDetails | null | undefined) => {
  return {
    people: new Map(
      (details?.people ?? []).map((person) => {
        return [person.userId, person]
      })
    ),
    sentMessages: new Map(
      (details?.messages ?? []).map((message) => {
        return [message.inputId, message]
      })
    )
  }
}

export const useChatSpeakers = ({
  harness,
  chatThreadId,
  agentName
}: UseChatSpeakersParams) => {
  const isBotThread = harness === 'bot'
  const brandQuery = useQuery(getBrandQueryOpts())
  const chatMarksQuery = useQuery(getChatMarksQueryOpts())
  const chatThreadQuery = useQuery(getChatThreadQueryOpts(chatThreadId))
  const workerIdentitiesQuery = useQuery({
    ...listWorkerIdentitiesQueryOpts(),
    enabled: !isBotThread
  })
  const chatMarks = chatMarksQuery.data ?? []
  const adapter = chatThreadId === null ? null : chatAdapterOf(chatThreadId)
  const chatMark =
    chatMarks.find((candidate) => {
      return candidate.adapter === adapter
    }) ?? chatMarks[0]
  const bot: ChatSpeaker = {
    fallback: 'brand',
    name: brandQuery.data?.name ?? chatMark?.bot?.name,
    avatarUrl: chatMark?.bot?.avatarUrl
  }
  const { people, sentMessages } = indexThread(chatThreadQuery.data)
  const identity = workerIdentitiesQuery.data?.find(({ name }) => {
    return name === agentName
  })

  const personOf = (message: PersonMessage): PersonSpeaker => {
    const chatInput = chatInputOf(message.id)

    if (chatInput === null && !isBotThread) {
      return { ...bot, sentAt: message.createdAt }
    }

    const sent =
      chatInput === null ? undefined : sentMessages.get(chatInput.inputId)
    const person = sent === undefined ? undefined : people.get(sent.authorId)

    return {
      fallback: 'person',
      name: person?.name,
      avatarUrl: person?.avatarUrl,
      sentAt: sent?.sentAt ?? message.createdAt
    }
  }

  return {
    details: chatThreadQuery.data ?? null,
    chatMark,
    agent: isBotThread
      ? bot
      : {
          fallback: 'worker' as const,
          name: agentName,
          avatarUrl: identity?.iconUrl
        },
    personOf
  }
}

export type ChatSpeakers = ReturnType<typeof useChatSpeakers>
