import type { PluginState } from '@tanstack/ai-harness'
import { SENT_FILE_EVENT, sentFileOfEvent } from '@workcell/core'
import { CARD_EVENT, cardOfEvent } from '#/cards/card-event.ts'
import type {
  ChatIdentity,
  ChatMessage,
  ChatSurface
} from '#/connection/chat-surface.ts'
import { takeUploads, type SentFileSource } from '#/files/sent-file-uploads.ts'
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

export async function messageOfEvent(
  name: string,
  value: unknown,
  sentFiles?: SentFileSource
): Promise<ChatMessage | undefined> {
  const card = name === CARD_EVENT ? cardOfEvent(value) : undefined

  if (card !== undefined) {
    return { card }
  }

  const sentFile = name === SENT_FILE_EVENT ? sentFileOfEvent(value) : undefined
  const files =
    sentFile === undefined ? [] : await takeUploads(sentFiles, [sentFile])

  return files.length === 0 ? undefined : { markdown: '', files }
}
