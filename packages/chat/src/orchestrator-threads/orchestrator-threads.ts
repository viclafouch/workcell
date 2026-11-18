import type {
  CardElement,
  Chat,
  SentMessage,
  StreamChunk,
  TaskUpdateChunk,
  Thread
} from 'chat'
import { z } from 'zod'
import { EventType, type StreamChunk as TurnEvent } from '@tanstack/ai'
import {
  BUDGET_END_EVENT,
  SENT_FILE_EVENT,
  sentFileOfEvent,
  type Orchestrator,
  type SentFile
} from '@workcell/core'
import { CARD_EVENT, cardOfEvent } from '#/cards/card-event.ts'
import type {
  ChatPrompt,
  OrchestratorRoute
} from '#/connection/chat-connection.ts'
import type { LogLine } from '#/connection/chat-logger.ts'
import type { ChatSurface, SessionStatus } from '#/connection/chat-surface.ts'
import { splitAtSafeSpace } from '#/connection/text-links.ts'
import { takeUploads, type SentFileSource } from '#/files/sent-file-uploads.ts'
import { CHAT_LINES, type ChatLines } from '#/prompts/chat.ts'

const TASK_DETAILS_MAX_LENGTH = 300

const toolOutputErrorSchema = z.object({
  tanstack: z.object({ state: z.literal('output-error') })
})

const budgetEndSchema = z.object({ message: z.string() })

type ThreadLog = {
  info: LogLine
  warn: LogLine
  error: LogLine
}

type CreateOrchestratorThreadsParams = {
  surface: ChatSurface
  orchestrator: Pick<Orchestrator, 'ask' | 'stop' | 'holds'>
  allowedStarters: readonly string[]
  allowedChannels: readonly string[]
  logger: { child: (bindings: Record<string, unknown>) => ThreadLog }
  lines?: ChatLines
  sentFiles?: SentFileSource
}

type Outcome = Awaited<ReturnType<Orchestrator['ask']>>['outcome']

const END_STATUS: Record<Outcome, SessionStatus> = {
  completed: 'active',
  aborted: 'active',
  failed: 'active',
  interrupted: 'suspended'
}

export function isOrchestratorThreadIn(
  chat: Chat,
  channels: readonly string[]
) {
  return (threadId: string) => {
    try {
      return channels.includes(chat.thread(threadId).channelId)
    } catch {
      return false
    }
  }
}

function detailsOf(input: unknown) {
  return input === undefined
    ? undefined
    : JSON.stringify(input).slice(0, TASK_DETAILS_MAX_LENGTH)
}

type ClosingLinesParams = {
  outcome: Outcome
  waits: readonly string[]
  budgetEnd: string | undefined
  lines: ChatLines
}

function closingLines({
  outcome,
  waits,
  budgetEnd,
  lines
}: ClosingLinesParams) {
  if (budgetEnd !== undefined) {
    return [budgetEnd]
  }

  if (outcome === 'aborted') {
    return [lines.stoppedTurn]
  }

  if (outcome === 'failed') {
    return [lines.failedTurn]
  }

  return outcome === 'interrupted' ? waits : []
}

type TurnEnding = { budgetEnd?: string }

type ReplyState = {
  controller?: ReadableStreamDefaultController<StreamChunk>
  posting?: Promise<SentMessage | null>
  text: string
  unsent: string
}

function createReplyStream(
  thread: Thread,
  log: ThreadLog,
  linked: (markdown: string) => string
) {
  const state: ReplyState = { text: '', unsent: '' }

  const postChunks = async (chunks: ReadableStream<StreamChunk>) => {
    try {
      return await thread.post(chunks)
    } catch (error) {
      log.error({ error }, 'orchestrator stream failed')

      return null
    }
  }

  const open = () => {
    state.posting ??= postChunks(
      new ReadableStream<StreamChunk>({
        start: (controller) => {
          state.controller = controller
        }
      })
    )
  }

  const sendText = (text: string) => {
    if (text === '') {
      return
    }

    const markdown = linked(text)
    state.text += markdown
    state.controller?.enqueue({ type: 'markdown_text', text: markdown })
  }

  const flushText = () => {
    sendText(state.unsent)
    state.unsent = ''
  }

  const push = (chunk: StreamChunk) => {
    open()

    if (chunk.type === 'markdown_text') {
      const { complete, rest } = splitAtSafeSpace(state.unsent + chunk.text)
      state.unsent = rest
      sendText(complete)

      return
    }

    flushText()
    state.controller?.enqueue(chunk)
  }

  const finish = async () => {
    flushText()
    state.controller?.close()
    const sent = await state.posting

    return {
      isStreamed: state.posting !== undefined,
      sent,
      text: state.text
    }
  }

  const hasText = () => {
    return state.text !== '' || state.unsent !== ''
  }

  return { push, finish, hasText }
}

export function createOrchestratorThreads({
  surface,
  orchestrator,
  allowedStarters,
  allowedChannels,
  logger,
  lines = CHAT_LINES,
  sentFiles
}: CreateOrchestratorThreadsParams): OrchestratorRoute {
  const log = logger.child({ module: 'chat' })
  const heldThreads = new Set<string>()

  const mayTalk = (user: string, channelId: string) => {
    return allowedStarters.includes(user) || allowedChannels.includes(channelId)
  }

  const holds = async (threadId: string) => {
    if (heldThreads.has(threadId)) {
      return true
    }

    const isHeld = await orchestrator.holds(threadId)

    if (isHeld) {
      heldThreads.add(threadId)
    }

    return isHeld
  }

  const answer = async ({
    thread,
    user,
    text,
    files,
    inputId
  }: ChatPrompt) => {
    const turnLog = logger.child({ module: 'chat', threadId: thread.id })
    const reply = createReplyStream(thread, turnLog, surface.linked)
    const tasks = new Map<string, TaskUpdateChunk>()
    const cards: CardElement[] = []
    const filesOfTurn: SentFile[] = []
    const ending: TurnEnding = {}
    let textMessageId = ''

    const updateTask = (id: string, change: Partial<TaskUpdateChunk>) => {
      const task = tasks.get(id)

      if (task === undefined) {
        return
      }

      const { type, title, status } = task
      tasks.set(id, { ...task, ...change })
      reply.push({ type, id, title, status, ...change })
    }

    const onEvent = (event: TurnEvent) => {
      if (event.type === EventType.TEXT_MESSAGE_CONTENT) {
        const separator =
          reply.hasText() && event.messageId !== textMessageId ? '\n\n' : ''
        textMessageId = event.messageId
        reply.push({
          type: 'markdown_text',
          text: `${separator}${event.delta}`
        })
      }

      if (event.type === EventType.TOOL_CALL_START) {
        const task: TaskUpdateChunk = {
          type: 'task_update',
          id: event.toolCallId,
          title: event.toolCallName,
          status: 'in_progress'
        }
        tasks.set(task.id, task)
        reply.push(task)
      }

      if (event.type === EventType.TOOL_CALL_END) {
        updateTask(event.toolCallId, { details: detailsOf(event.input) })
      }

      if (event.type === EventType.TOOL_CALL_RESULT) {
        updateTask(event.toolCallId, {
          status: toolOutputErrorSchema.safeParse(event.metadata).success
            ? 'error'
            : 'complete'
        })
      }

      if (event.type === EventType.CUSTOM && event.name === BUDGET_END_EVENT) {
        ending.budgetEnd = budgetEndSchema.safeParse(event.value).data?.message
      }

      if (event.type === EventType.CUSTOM && event.name === CARD_EVENT) {
        const card = cardOfEvent(event.value)

        if (card !== undefined) {
          cards.push(card)
        }
      }

      if (event.type === EventType.CUSTOM && event.name === SENT_FILE_EVENT) {
        const sentFile = sentFileOfEvent(event.value)

        if (sentFile !== undefined) {
          filesOfTurn.push(sentFile)
        }
      }
    }

    heldThreads.add(thread.id)
    await thread.startTyping()

    const { ownsTurn, outcome, error, waits } = await orchestrator.ask({
      threadId: thread.id,
      user: { id: user },
      inputId,
      message: text,
      files,
      onEvent
    })

    if (!ownsTurn) {
      return
    }

    if (outcome === 'failed') {
      turnLog.error({ error }, 'orchestrator turn failed')
    }

    const closing = closingLines({
      outcome,
      waits,
      budgetEnd: ending.budgetEnd,
      lines
    }).join('\n\n')

    if (closing !== '') {
      reply.push({
        type: 'markdown_text',
        text: reply.hasText() ? `\n\n${closing}` : closing
      })
    }

    const { isStreamed, sent, text: answered } = await reply.finish()

    if (isStreamed && sent === null && answered !== '') {
      await thread.post({ markdown: answered })
    }

    for (const card of cards) {
      // oxlint-disable-next-line no-await-in-loop -- the cards post in the order the turn showed them
      await thread.post({ card })
    }

    const uploads = await takeUploads(sentFiles, filesOfTurn)

    if (uploads.length > 0) {
      await thread.post({ markdown: '', files: uploads })
    }

    if (!isStreamed || outcome === 'interrupted') {
      await surface.setStatus(thread.id, END_STATUS[outcome])
    }
  }

  const ask = async (prompt: ChatPrompt) => {
    const { thread, user } = prompt

    if (!mayTalk(user, thread.channelId)) {
      log.info(
        { user, channelId: thread.channelId },
        'a mention outside the allowed channels left alone'
      )

      return
    }

    try {
      await answer(prompt)
    } catch (error) {
      log.error({ error, threadId: thread.id }, 'orchestrator turn failed')
      await thread.post({ markdown: lines.failedTurn })
      await surface.setStatus(thread.id, 'active')
    }
  }

  const reply = async (prompt: ChatPrompt) => {
    if (
      mayTalk(prompt.user, prompt.thread.channelId) &&
      (await holds(prompt.thread.id))
    ) {
      await ask(prompt)
    }
  }

  const stop = async (threadId: string, user: string) => {
    if (!mayTalk(user, surface.channelOf(threadId))) {
      log.info(
        { user, threadId },
        'a stop outside the allowed channels left alone'
      )

      return
    }

    const stopped = await orchestrator.stop({ threadId, user: { id: user } })
    log.info({ user, threadId, stopped }, 'chat stop')

    if (!stopped) {
      await surface.setStatus(threadId, 'active')
    }
  }

  return { ask, reply, stop }
}
