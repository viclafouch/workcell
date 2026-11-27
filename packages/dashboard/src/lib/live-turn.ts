import type { ViewMessage } from '@tanstack/ai-harness/view'
import type { ChatThreadDetails } from '#/server/dashboard-context.ts'
import { chatInputOf } from './chat-input.ts'
import type { PersonMessage } from './chat-turns.ts'

const LIVE_MESSAGE_PREFIX = 'turn-'

const INPUT_MESSAGE_PREFIX = 'user-'

export const matchIsLiveMessage = (message: ViewMessage) => {
  return (
    message.role === 'assistant' && message.id.startsWith(LIVE_MESSAGE_PREFIX)
  )
}

type PendingQuestionParams = {
  messages: readonly ViewMessage[]
  details: ChatThreadDetails | null
  isRunning: boolean
}

export const pendingQuestionOf = ({
  messages,
  details,
  isRunning
}: PendingQuestionParams): PersonMessage | null => {
  const chatMessages = details?.messages ?? []
  const asked = chatMessages.findLast(({ isMe }) => {
    return !isMe
  })

  if (
    asked === undefined ||
    !(isRunning || messages.some(matchIsLiveMessage))
  ) {
    return null
  }

  const shownInputs = new Set(
    messages.flatMap(({ id }) => {
      const chatInput = chatInputOf(id)

      return chatInput === null ? [] : [chatInput.inputId]
    })
  )
  const lastShownSentAt = Math.max(
    0,
    ...chatMessages.flatMap(({ inputId, sentAt }) => {
      return shownInputs.has(inputId) ? [sentAt] : []
    })
  )

  if (shownInputs.has(asked.inputId) || asked.sentAt <= lastShownSentAt) {
    return null
  }

  return {
    id: `${INPUT_MESSAGE_PREFIX}${asked.inputId}`,
    role: 'user',
    text: asked.text,
    createdAt: asked.sentAt
  }
}

export const withPendingQuestion = (
  messages: readonly ViewMessage[],
  question: PersonMessage | null
) => {
  if (question === null) {
    return messages
  }

  const liveStart = messages.findIndex(matchIsLiveMessage)

  return liveStart === -1
    ? [...messages, question]
    : [...messages.slice(0, liveStart), question, ...messages.slice(liveStart)]
}
