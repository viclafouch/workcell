import type { PluginState } from '@tanstack/ai-harness'
import { CARD_EVENT, cardOfEvent } from '#/cards/card-event.ts'
import type {
  ChatIdentity,
  ChatMessage,
  ChatSurface
} from '#/connection/chat-surface.ts'
import { FILE_EVENT, fileOfEvent, toFileUpload } from '#/files/file-event.ts'
import type { PostedWait } from './worker-waits.ts'

export type ThreadPosts = {
  planMessageId?: string
  askedWaits: string[]
}

export async function markAsked(
  posted: PluginState<ThreadPosts>,
  waitIds: readonly string[]
) {
  await posted.update((current) => {
    return { ...current, askedWaits: [...current.askedWaits, ...waitIds] }
  })
}

type QuestionTarget = {
  surface: ChatSurface
  posted: PluginState<ThreadPosts>
  threadId: string
  identity: ChatIdentity
}

export async function postQuestions(
  { surface, posted, threadId, identity }: QuestionTarget,
  waits: readonly PostedWait[]
) {
  const { askedWaits } = await posted.get()
  const unasked = waits.filter(({ waitId }) => {
    return !askedWaits.includes(waitId)
  })

  for (const { waitId, text } of unasked) {
    // oxlint-disable-next-line no-await-in-loop -- the questions post in order, each one marked asked before the next, so a restart posts none twice
    await surface.post({
      target: { threadId },
      identity,
      message: { markdown: text }
    })
    // oxlint-disable-next-line no-await-in-loop -- the questions post in order, each one marked asked before the next, so a restart posts none twice
    await markAsked(posted, [waitId])
  }
}

export type EventPost = { message: ChatMessage; asBot: boolean }

export function postOfEvent(name: string, value: unknown): EventPost | undefined {
  const card = name === CARD_EVENT ? cardOfEvent(value) : undefined

  if (card !== undefined) {
    return { message: { card }, asBot: false }
  }

  const sentFile = name === FILE_EVENT ? fileOfEvent(value) : undefined

  return sentFile === undefined
    ? undefined
    : {
        message: { markdown: '', files: [toFileUpload(sentFile)] },
        asBot: true
      }
}
