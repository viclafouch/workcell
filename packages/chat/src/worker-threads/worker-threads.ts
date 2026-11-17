import { z } from 'zod'
import type { ChatMiddleware } from '@tanstack/ai'
import {
  definePlugin,
  type AnyHarness,
  type HarnessHost,
  type TurnInfo
} from '@tanstack/ai-harness'
import {
  joinCutOffAnswer,
  pausedInterrupts,
  todosOf,
  workerMetadataSchema,
  type LiveWorker,
  type MessageWorkerParams,
  type StopWorkerParams,
  type ThreadLine,
  type WorkerApproval,
  type WorkerChange,
  type WorkerMetadata
} from '@workcell/core'
import { CARD_EVENT, cardOfEvent } from '#/cards/card-event.ts'
import type {
  ApprovalClick,
  ThreadRoute
} from '#/connection/chat-connection.ts'
import type { LogLine } from '#/connection/chat-logger.ts'
import type {
  ChatIdentity,
  ChatMessage,
  ChatSurface,
  SessionStatus
} from '#/connection/chat-surface.ts'
import { readVoice } from '#/plugins/voice.ts'
import {
  CHAT_LINES,
  threadOpeningPrompt,
  type ChatLines
} from '#/prompts/chat.ts'
import {
  approvalCard,
  decidedCard,
  openingCard,
  planCard,
  type WorkerThreadLink
} from './worker-thread-cards.ts'
import {
  markAsked,
  postQuestions,
  refreshOpening,
  type ThreadPosts
} from './worker-thread-posts.ts'
import {
  stoppedWait,
  unaskedApprovals,
  waitIdOf,
  waitsOfKind,
  type PostedWait,
  type StoppedWait
} from './worker-waits.ts'

const THREAD_PLUGIN = 'workcell/chat-worker-thread'

const TODO_WRITE = 'todo_write'

const OPENING_LABEL = 'thread-opening'

const SESSION_STATUS = {
  running: 'processing',
  waiting: 'suspended',
  idle: 'active'
} as const satisfies Record<LiveWorker['liveStatus'], SessionStatus>

const threadSchema = z.object({ chatThreadId: z.string() })

const postedLinesSchema = z.object({
  chatPostedLines: z.array(z.string()).default([])
})

const threadMetadataSchema = workerMetadataSchema.extend({
  ...threadSchema.partial().shape,
  ...postedLinesSchema.partial().shape
})

type OpenedThread = { threadId: string; identity: ChatIdentity }

type WorkerThreadState = { opened?: OpenedThread }

export type WorkerProfile = { name: string; title: string; iconUrl?: string }

type WorkerLog = { info: LogLine }

type CreateWorkerThreadsParams = {
  surface: ChatSurface
  channelId: string
  workers: readonly WorkerProfile[]
  allowedStarters: readonly string[]
  logger: { child: (bindings: Record<string, unknown>) => WorkerLog }
  links?: (worker: WorkerMetadata) => readonly WorkerThreadLink[]
  voiceFile?: string
  lines?: ChatLines
}

type WorkerThreadRoutesOptions = {
  liveWorkers: () => LiveWorker[]
  workers: {
    messageWorker: (message: MessageWorkerParams) => Promise<void>
    answerApproval: (approval: WorkerApproval) => Promise<boolean>
    stopWorker: (stop: StopWorkerParams) => Promise<boolean>
  }
}

type LinePosterOptions = {
  liveWorkers: () => LiveWorker[]
  host: Pick<HarnessHost, 'sessions'>
  harness: AnyHarness
}

type ClickAnswerOptions = {
  surface: ChatSurface
  workers: Pick<WorkerThreadRoutesOptions['workers'], 'answerApproval'>
  threadId: string
  workerThreadId: string
  log: WorkerLog
  lines: ChatLines
}

function workerProfiles(workers: readonly WorkerProfile[]) {
  const profileOf = new Map(
    workers.map((profile) => {
      return [profile.name, profile]
    })
  )

  return (worker: string): WorkerProfile => {
    return (
      profileOf.get(worker) ?? {
        name: worker,
        title: worker
      }
    )
  }
}

function identityOfProfile({ name, iconUrl }: WorkerProfile): ChatIdentity {
  return { name, iconUrl }
}

function noLinks(): WorkerThreadLink[] {
  return []
}

export function threadOf(metadata: unknown): string | undefined {
  return threadSchema.safeParse(metadata).data?.chatThreadId
}

type TaskOfThread = { subject?: string; task: string }

function taskName({ subject, task }: TaskOfThread) {
  return subject ?? task.split('\n')[0] ?? task
}

function openingMessages(task: TaskOfThread) {
  return [
    {
      role: 'user' as const,
      content: threadOpeningPrompt(taskName(task), task.task)
    }
  ]
}

async function answerClick(
  {
    surface,
    workers,
    threadId,
    workerThreadId,
    log,
    lines
  }: ClickAnswerOptions,
  { user, waitId, answer, messageId, asked, tell }: ApprovalClick
) {
  const isAnswered = await workers.answerApproval({
    threadId,
    waitId,
    approver: { id: user },
    answer
  })

  if (!isAnswered) {
    log.info({ user, waitId }, 'an approval already settled')
    await tell(lines.settledApproval)

    return
  }

  log.info({ user, waitId, answer }, 'approval answered')
  await surface.edit({
    threadId: workerThreadId,
    messageId,
    message: decidedCard({
      asked,
      answer,
      approver: surface.mention(workerThreadId, user),
      lines
    })
  })
}

function followChanges(
  surface: ChatSurface,
  identityOf: (worker: string) => ChatIdentity
) {
  return async (change: WorkerChange) => {
    const threadId = threadOf(change.worker)

    if (threadId === undefined) {
      return
    }

    if (change.type === 'finished') {
      if (change.worker.report !== undefined) {
        await surface.post({
          target: { threadId },
          identity: identityOf(change.worker.name),
          message: { markdown: change.worker.report }
        })
      }

      await surface.setStatus(threadId, 'closed')

      return
    }

    await surface.setStatus(threadId, SESSION_STATUS[change.worker.liveStatus])
  }
}

function postLineOnce({
  liveWorkers,
  host,
  harness,
  surface,
  identityOf
}: LinePosterOptions & {
  surface: ChatSurface
  identityOf: (worker: string) => ChatIdentity
}) {
  return async ({ threadId, inputId, line }: ThreadLine) => {
    const worker = liveWorkers().find((live) => {
      return live.threadId === threadId
    })
    const chatThreadId = threadOf(worker)

    if (worker === undefined || chatThreadId === undefined) {
      return
    }

    const { chatPostedLines } = postedLinesSchema.parse(worker)

    if (chatPostedLines.includes(inputId)) {
      return
    }

    await surface.post({
      target: { threadId: chatThreadId },
      identity: identityOf(worker.name),
      message: { markdown: line }
    })
    await host.sessions.update({
      harness,
      threadId,
      update: (entry) => {
        return entry.metadata === undefined
          ? {}
          : {
              metadata: {
                ...entry.metadata,
                chatPostedLines: [
                  ...postedLinesSchema.parse(entry.metadata).chatPostedLines,
                  inputId
                ]
              }
            }
      }
    })
  }
}

type RouteOfThreadParams = WorkerThreadRoutesOptions & {
  chatThreadId: string
  surface: ChatSurface
  allowedStarters: readonly string[]
  logger: { child: (bindings: Record<string, unknown>) => WorkerLog }
  lines: ChatLines
}

function routeOfThread({
  chatThreadId,
  liveWorkers,
  workers,
  surface,
  allowedStarters,
  logger,
  lines
}: RouteOfThreadParams): ThreadRoute | undefined {
  const worker = liveWorkers().find((live) => {
    return threadOf(live) === chatThreadId
  })

  if (worker === undefined) {
    return undefined
  }

  const { threadId, name } = worker
  const log = logger.child({ module: 'chat', threadId, worker: name })

  const ignoresColleague = (user: string) => {
    const isColleague = !allowedStarters.includes(user)

    if (isColleague) {
      log.info({ user }, 'a colleague in a worker thread left alone')
    }

    return isColleague
  }

  return {
    reply: async ({ user, text, inputId }) => {
      if (ignoresColleague(user)) {
        return
      }

      await workers.messageWorker({
        threadId,
        sender: { id: user },
        inputId,
        message: text
      })
    },
    approve: async (click) => {
      if (ignoresColleague(click.user)) {
        return
      }

      await answerClick(
        {
          surface,
          workers,
          threadId,
          workerThreadId: chatThreadId,
          log,
          lines
        },
        click
      )
    },
    stop: async (user) => {
      if (ignoresColleague(user)) {
        return
      }

      const stopped = await workers.stopWorker({
        threadId,
        user: { id: user }
      })

      if (!stopped) {
        await surface.setStatus(chatThreadId, SESSION_STATUS[worker.liveStatus])
      }
    }
  }
}

export function createWorkerThreads({
  surface,
  channelId,
  workers: profiles,
  allowedStarters,
  logger,
  links: linksOf = noLinks,
  voiceFile,
  lines = CHAT_LINES
}: CreateWorkerThreadsParams) {
  const profileOf = workerProfiles(profiles)

  const identityOf = (worker: string) => {
    return identityOfProfile(profileOf(worker))
  }

  const voicePrompts = async () => {
    return voiceFile === undefined ? [] : [await readVoice(voiceFile)]
  }

  const plugin = definePlugin({
    name: THREAD_PLUGIN,
    metadataSchema: threadMetadataSchema,
    setup: (setupContext) => {
      const posted = setupContext.state<ThreadPosts>({ askedWaits: [] })
      const workerThread: WorkerThreadState = {}
      const stoppedWaits: StoppedWait[] = []

      const safely = async (what: string, work: () => Promise<void>) => {
        try {
          await work()
        } catch (error) {
          setupContext.logger.error(`[${THREAD_PLUGIN}] The ${what} failed.`, {
            error,
            threadId: setupContext.session.threadId
          })
        }
      }

      const openingLine = async (run: TurnInfo['run'], task: TaskOfThread) => {
        try {
          const { text } = await setupContext.model.chat({
            run,
            label: OPENING_LABEL,
            options: {
              systemPrompts: await voicePrompts(),
              messages: openingMessages(task)
            }
          })

          return text.trim() || taskName(task)
        } catch (error) {
          setupContext.logger.error(
            `[${THREAD_PLUGIN}] The opening line failed: the thread opens on the task name.`,
            { error, threadId: setupContext.session.threadId }
          )

          return taskName(task)
        }
      }

      const refreshLinks = async (metadata: WorkerMetadata) => {
        if (workerThread.opened === undefined) {
          return
        }

        await refreshOpening({
          surface,
          posted,
          threadId: workerThread.opened.threadId,
          links: linksOf(metadata),
          approvers: allowedStarters,
          lines
        })
      }

      const openThread = async ({ run }: TurnInfo) => {
        const entry = await setupContext.session.indexEntry()
        const metadata = entry?.metadata

        if (metadata === undefined) {
          return
        }

        const profile = profileOf(metadata.name)
        const identity = identityOfProfile(profile)
        const openedThreadId = threadOf(metadata)

        if (openedThreadId !== undefined) {
          workerThread.opened = { threadId: openedThreadId, identity }
          await refreshLinks(metadata)

          return
        }

        const links = linksOf(metadata)
        const line = `${lines.greeting(profile.title)}\n${await openingLine(run, metadata)}`
        const opening = await surface.post({
          target: { channelId },
          identity,
          message: openingCard({
            line,
            links,
            approvers: allowedStarters,
            lines
          })
        })
        await posted.update((current) => {
          return {
            ...current,
            opening: {
              line,
              links: JSON.stringify(links),
              messageId: opening.messageId
            }
          }
        })
        workerThread.opened = { threadId: opening.threadId, identity }
        await surface.subscribe(opening.threadId)
        await setupContext.session.updateIndexEntry((current) => {
          return current.metadata === undefined
            ? {}
            : {
                metadata: {
                  ...current.metadata,
                  chatThreadId: opening.threadId
                }
              }
        })
        await surface.setStatus(opening.threadId, 'processing')
      }

      const postInThread = async (message: ChatMessage) => {
        if (workerThread.opened === undefined) {
          return
        }

        const { threadId, identity } = workerThread.opened
        await surface.post({ target: { threadId }, identity, message })
      }

      const showPlan = async () => {
        const todos = todosOf(setupContext.session.snapshot().plugins)

        if (workerThread.opened === undefined || !todos) {
          return
        }

        const { threadId, identity } = workerThread.opened
        const message = planCard(todos, lines)
        const { planMessageId } = await posted.get()

        if (planMessageId !== undefined) {
          await surface.edit({ threadId, messageId: planMessageId, message })

          return
        }

        const plan = await surface.post({
          target: { threadId },
          identity,
          message
        })
        await posted.update((current) => {
          return { ...current, planMessageId: plan.messageId }
        })
      }

      const askWaits = async (waits: readonly PostedWait[]) => {
        if (workerThread.opened !== undefined) {
          await postQuestions(
            { surface, posted, ...workerThread.opened },
            waits
          )
        }
      }

      const askApprovals = async (waits: readonly PostedWait[]) => {
        const { askedWaits } = await posted.get()
        const approvals = unaskedApprovals(waits, askedWaits)

        if (workerThread.opened === undefined || approvals.length === 0) {
          return
        }

        await postInThread(
          approvalCard({ approvals, approvers: allowedStarters, lines })
        )
        await markAsked(posted, approvals.map(waitIdOf))
      }

      const threadMessages: ChatMiddleware = {
        name: THREAD_PLUGIN,
        onStart: () => {
          stoppedWaits.splice(0)
        },
        onChunk: async ({ messages }, chunk) => {
          if (chunk.type === 'CUSTOM' && chunk.name === CARD_EVENT) {
            const card = cardOfEvent(chunk.value)

            if (card !== undefined) {
              await safely('card post', () => {
                return postInThread({ card })
              })
            }
          }

          const waits = (pausedInterrupts(chunk) ?? []).map((interrupt) => {
            return stoppedWait(interrupt, messages)
          })
          stoppedWaits.push(
            ...waitsOfKind(waits, 'question'),
            ...waitsOfKind(waits, 'approval')
          )
          const limitStops = waitsOfKind(waits, 'human')

          if (limitStops.length > 0) {
            await safely('limit question post', () => {
              return askWaits(limitStops)
            })
          }
        },
        onAfterToolCall: async (_ctx, { toolName, ok }) => {
          if (ok && toolName === TODO_WRITE) {
            await safely('plan update', showPlan)
          }
        },
        onFinish: async ({ messages }, { content }) => {
          const waits = stoppedWaits.splice(0)
          const answer = joinCutOffAnswer(messages, content).trim()
          await safely('answer post', async () => {
            if (answer !== '') {
              await postInThread({ markdown: answer })
            }
          })
          await safely('question post', () => {
            return askWaits(waitsOfKind(waits, 'question'))
          })
          await safely('approval post', () => {
            return askApprovals(waitsOfKind(waits, 'approval'))
          })
          await safely('links refresh', async () => {
            const entry = await setupContext.session.indexEntry()

            if (entry?.metadata !== undefined) {
              await refreshLinks(entry.metadata)
            }
          })
        }
      }

      return {
        onTurnStart: async (turn) => {
          await safely('thread start', () => {
            return openThread(turn)
          })
        },
        middleware: [threadMessages]
      }
    }
  })

  const follow = followChanges(surface, identityOf)

  const linePoster = (options: LinePosterOptions) => {
    return postLineOnce({ ...options, surface, identityOf })
  }

  const routes = ({ liveWorkers, workers }: WorkerThreadRoutesOptions) => {
    return (chatThreadId: string) => {
      return routeOfThread({
        chatThreadId,
        liveWorkers,
        workers,
        surface,
        allowedStarters,
        logger,
        lines
      })
    }
  }

  return { plugin, follow, linePoster, routes }
}
