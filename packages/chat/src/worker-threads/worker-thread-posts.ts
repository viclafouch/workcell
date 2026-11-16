import type { PluginState } from '@tanstack/ai-harness'
import type { ChatIdentity, ChatSurface } from '#/connection/chat-surface.ts'
import type { ChatLines } from '#/prompts/chat.ts'
import { openingCard, type WorkerThreadLink } from './worker-thread-cards.ts'
import type { PostedWait } from './worker-waits.ts'

export type ThreadPosts = {
  planMessageId?: string
  askedWaits: string[]
  opening?: { line: string; links: string; messageId: string }
}

type RefreshOpeningParams = {
  surface: ChatSurface
  posted: PluginState<ThreadPosts>
  threadId: string
  links: readonly WorkerThreadLink[]
  approvers: readonly string[]
  lines: ChatLines
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

export async function refreshOpening({
  surface,
  posted,
  threadId,
  links,
  approvers,
  lines
}: RefreshOpeningParams) {
  const { opening } = await posted.get()
  const linksKey = JSON.stringify(links)

  if (opening === undefined || opening.links === linksKey) {
    return
  }

  await surface.edit({
    threadId,
    messageId: opening.messageId,
    message: openingCard({ line: opening.line, links, approvers, lines })
  })
  await posted.update((current) => {
    return { ...current, opening: { ...opening, links: linksKey } }
  })
}
