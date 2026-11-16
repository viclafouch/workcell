import type { ActionEvent, Chat, Message, Thread } from 'chat'
import type { WorkerApproval } from '@workcell/core'
import { CHAT_LINES, type ChatLines } from '#/prompts/chat.ts'
import type { LogLine } from './chat-logger.ts'

export const APPROVAL_ACTIONS = {
  once: 'worker_approval_once',
  reject: 'worker_approval_reject'
} as const

export const STOP_ACTION = 'worker_stop'

export type ChatPrompt = {
  thread: Thread
  user: string
  text: string
  inputId: string
}

export type ApprovalClick = {
  user: string
  waitId: string
  answer: WorkerApproval['answer']
  messageId: string
  asked: string
  tell: (text: string) => Promise<void>
}

export type OrchestratorRoute = {
  ask: (prompt: ChatPrompt) => Promise<void>
  reply: (prompt: ChatPrompt) => Promise<void>
  stop: (threadId: string, user: string) => Promise<void>
}

export type ThreadRoute = {
  reply: (prompt: ChatPrompt) => Promise<void>
  approve: (click: ApprovalClick) => Promise<void>
  stop: (user: string) => Promise<void>
}

type ConnectionLog = { info: LogLine; warn: LogLine }

type OpenChatConnectionParams = {
  chat: Chat
  orchestrator: OrchestratorRoute
  logger: { child: (bindings: Record<string, unknown>) => ConnectionLog }
  routeThread?: (threadId: string) => ThreadRoute | undefined
  lines?: ChatLines
}

function promptOf(thread: Thread, message: Message): ChatPrompt {
  return {
    thread,
    user: message.author.userId,
    text: message.text,
    inputId: `chat:${thread.id}:${message.id}`
  }
}

async function askedText(event: ActionEvent, fallback: string) {
  const message = await event.adapter.fetchMessage?.(
    event.threadId,
    event.messageId
  )

  return message?.text || fallback
}

export async function openChatConnection({
  chat,
  orchestrator,
  logger,
  routeThread,
  lines = CHAT_LINES
}: OpenChatConnectionParams) {
  const log = logger.child({ module: 'chat' })

  const routeOf = (threadId: string) => {
    return routeThread?.(threadId)
  }

  const isShared = (thread: Thread) => {
    if (thread.channelVisibility !== 'external') {
      return false
    }

    log.info(
      { threadId: thread.id },
      'a message of a shared channel left alone'
    )

    return true
  }

  const isLeftAlone = (thread: Thread, message: Message) => {
    if (message.author.isBot === true) {
      return true
    }

    return isShared(thread)
  }

  chat.onNewMention(async (thread, message) => {
    if (isLeftAlone(thread, message)) {
      return
    }

    const route = routeOf(thread.id)

    if (route !== undefined) {
      await thread.subscribe()
      await route.reply(promptOf(thread, message))

      return
    }

    await thread.subscribe()
    await orchestrator.ask(promptOf(thread, message))
  })

  chat.onDirectMessage(async (thread, message) => {
    if (isLeftAlone(thread, message)) {
      return
    }

    await orchestrator.ask(promptOf(thread, message))
  })

  chat.onSubscribedMessage(async (thread, message) => {
    if (isLeftAlone(thread, message)) {
      return
    }

    const route = routeOf(thread.id)
    const prompt = promptOf(thread, message)

    await (route === undefined
      ? orchestrator.reply(prompt)
      : route.reply(prompt))
  })

  chat.onAction(
    [APPROVAL_ACTIONS.once, APPROVAL_ACTIONS.reject],
    async (event) => {
      const tell = async (text: string) => {
        await event.thread?.postEphemeral(
          event.user,
          { markdown: text },
          {
            fallbackToDM: false
          }
        )
      }
      const route = routeOf(event.threadId)

      if (route === undefined || event.value === undefined) {
        log.info(
          { threadId: event.threadId, user: event.user.userId },
          'approval click with no worker thread left alone'
        )
        await tell(lines.settledApproval)

        return
      }

      await route.approve({
        user: event.user.userId,
        waitId: event.value,
        answer: event.actionId === APPROVAL_ACTIONS.once ? 'once' : 'reject',
        messageId: event.messageId,
        asked: await askedText(event, lines.approvalQuestion),
        tell
      })
    }
  )

  chat.onAction(STOP_ACTION, async (event) => {
    const route = routeOf(event.threadId)

    if (route === undefined) {
      await event.thread?.postEphemeral(
        event.user,
        { markdown: lines.noWorkerInThread },
        { fallbackToDM: false }
      )

      return
    }

    await route.stop(event.user.userId)
  })

  chat.onAgentSessionStopped(async ({ threadId, userId }) => {
    const route = routeOf(threadId)

    await (route === undefined
      ? orchestrator.stop(threadId, userId)
      : route.stop(userId))
  })

  await chat.initialize()
  log.info({}, 'The chat connection is open.')

  return {
    [Symbol.asyncDispose]: async () => {
      await chat.shutdown()
    }
  }
}
