import { z } from 'zod'
import type { ChatMiddleware } from '@tanstack/ai'
import {
  definePlugin,
  type AnyHarness,
  type HarnessHost
} from '@tanstack/ai-harness'
import {
  joinCutOffAnswer,
  pausedInterrupts,
  todosOf,
  WorkerSandboxSetup,
  workerMetadataSchema,
  type LiveWorker,
  type MessageWorkerParams,
  type StopWorkerParams,
  type ThreadLine,
  type WorkerApproval,
  type WorkerChange,
  type WorkerMetadata
} from '@workcell/core'
import type {
  ApprovalClick,
  ThreadRoute
} from '#/connection/chat-connection.ts'
import type { LogLine } from '#/connection/chat-logger.ts'
import type {
  ChatIdentity,
  ChatMessage,
  ChatSurface
} from '#/connection/chat-surface.ts'
import type { SentFileSource } from '#/files/sent-file-uploads.ts'
import { CHAT_LINES, type ChatLines } from '#/prompts/chat.ts'
import {
  approvalCard,
  decidedCard,
  workerOpening,
  planCard,
  type WorkerThreadLink
} from './worker-thread-cards.ts'
import {
  markAsked,
  messageOfEvent,
  postQuestions,
  type ThreadPosts
} from './worker-thread-posts.ts'
import {
  createThreadStatus,
  type ThreadStatus
} from './worker-thread-status.ts'
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

const TURN_STATUSES = new Set<LiveWorker['liveStatus']>(['queued', 'running'])

const threadSchema = z.object({ chatThreadId: z.string() })

const openingSchema = z.object({ messageId: z.string(), links: z.string() })

const postedLinesSchema = z.object({
  chatPostedLines: z.array(z.string()).default([])
})

const threadMetadataSchema = workerMetadataSchema.extend({
  ...threadSchema.partial().shape,
  chatOpening: openingSchema.optional(),
  ...postedLinesSchema.partial().shape
})

type ThreadMetadata = z.infer<typeof threadMetadataSchema>

const openedThreadSchema = threadSchema.extend({ chatOpening: openingSchema })

type OpenedThreadMetadata = z.infer<typeof openedThreadSchema>

type OpenedThread = { threadId: string; identity: ChatIdentity }

type WorkerThreadState = { opened?: OpenedThread }

export type WorkerProfile = { name: string; title: string; iconUrl?: string }

type WorkerLog = { info: LogLine; error: LogLine }

type CreateWorkerThreadsParams = {
  surface: ChatSurface
  channelId: string
  workers: readonly WorkerProfile[]
  allowedStarters: readonly string[]
  logger: { child: (bindings: Record<string, unknown>) => WorkerLog }
  links?: (worker: WorkerMetadata) => readonly WorkerThreadLink[]
  lines?: ChatLines
  sentFiles?: SentFileSource
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

type FollowChangesParams = {
  identityOf: (worker: string) => ChatIdentity
  surface: ChatSurface
  status: ThreadStatus
  openingOf: (
    metadata: WorkerMetadata,
    isOpen: boolean
  ) => { message: ChatMessage }
}

function followChanges({
  identityOf,
  surface,
  status,
  openingOf
}: FollowChangesParams) {
  return async (change: WorkerChange) => {
    const threadId = threadOf(change.worker)

    if (threadId === undefined) {
      return
    }

    if (change.type === 'finished') {
      const identity = identityOf(change.worker.name)
      const opening = openedThreadSchema.safeParse(change.worker).data?.chatOpening

      if (opening !== undefined) {
        await surface.edit({
          threadId,
          messageId: opening.messageId,
          message: openingOf(change.worker, false).message
        })
      }

      if (change.worker.report !== undefined) {
        await surface.post({
          target: { threadId },
          identity,
          message: { markdown: change.worker.report }
        })
      }

      await status.close(threadId, identity)

      return
    }

    await status.showLive(threadId, change.worker)
  }
}

function workerThreadOf(metadata: WorkerMetadata | undefined) {
  const threadId = threadOf(metadata)

  return metadata === undefined || threadId === undefined
    ? undefined
    : { threadId, worker: metadata.name }
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
  status: ThreadStatus
  allowedStarters: readonly string[]
  logger: { child: (bindings: Record<string, unknown>) => WorkerLog }
  lines: ChatLines
}

function routeOfThread({
  chatThreadId,
  liveWorkers,
  workers,
  surface,
  status,
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
    reply: async ({ user, text, files, inputId }) => {
      if (ignoresColleague(user)) {
        return
      }

      if (!TURN_STATUSES.has(worker.liveStatus)) {
        await status.showLine(chatThreadId, lines.readingStatus, name)
      }

      try {
        await workers.messageWorker({
          threadId,
          sender: { id: user },
          inputId,
          message: text,
          files
        })
      } catch (error) {
        await status.showLive(chatThreadId, worker)
        throw error
      }
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
        await status.showLive(chatThreadId, worker)
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
  lines = CHAT_LINES,
  sentFiles
}: CreateWorkerThreadsParams) {
  const profileOf = workerProfiles(profiles)

  const identityOf = (worker: string) => {
    return identityOfProfile(profileOf(worker))
  }

  const status = createThreadStatus({ surface, identityOf, lines, logger })

  const openingOf = (metadata: WorkerMetadata, isOpen = true) => {
    return workerOpening({
      metadata,
      title: profileOf(metadata.name).title,
      links: linksOf(metadata),
      approvers: allowedStarters,
      lines,
      isOpen
    })
  }

  const followOpenedThread = async (threadId: string, worker: string) => {
    try {
      await surface.subscribe(threadId)
      await surface.setStatus(threadId, 'processing', identityOf(worker))
    } catch (error) {
      logger
        .child({ module: 'chat', worker })
        .error({ error, threadId }, 'worker thread opened, not followed')
    }
  }

  const open = async (
    metadata: WorkerMetadata
  ): Promise<OpenedThreadMetadata> => {
    const { linksKey, message } = openingOf(metadata)
    const opening = await surface.post({
      target: { channelId },
      identity: identityOf(metadata.name),
      message
    })
    await followOpenedThread(opening.threadId, metadata.name)

    return {
      chatThreadId: opening.threadId,
      chatOpening: { messageId: opening.messageId, links: linksKey }
    }
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

      const mergeMetadata = async (extra: Partial<ThreadMetadata>) => {
        await setupContext.session.updateIndexEntry((current) => {
          return current.metadata === undefined
            ? {}
            : { metadata: { ...current.metadata, ...extra } }
        })
      }

      const refreshLinks = async (metadata: ThreadMetadata) => {
        const { chatThreadId, chatOpening } = metadata

        if (chatThreadId === undefined || chatOpening === undefined) {
          return
        }

        const { linksKey, message } = openingOf(metadata)

        if (chatOpening.links === linksKey) {
          return
        }

        await surface.edit({
          threadId: chatThreadId,
          messageId: chatOpening.messageId,
          message
        })
        await mergeMetadata({
          chatOpening: { ...chatOpening, links: linksKey }
        })
      }

      const openThread = async () => {
        const entry = await setupContext.session.indexEntry()
        const metadata = entry?.metadata

        if (metadata === undefined) {
          return
        }

        const identity = identityOf(metadata.name)
        const openedThreadId = threadOf(metadata)

        if (openedThreadId !== undefined) {
          workerThread.opened = { threadId: openedThreadId, identity }
          await refreshLinks(metadata)

          return
        }

        const opened = await open(metadata)
        await mergeMetadata(opened)
        workerThread.opened = { threadId: opened.chatThreadId, identity }
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

      status.followSetupEvents({
        listen: (handler) => {
          setupContext.on(WorkerSandboxSetup, handler)
        },
        readWorkerThread: async () => {
          const entry = await setupContext.session.indexEntry()

          return workerThreadOf(entry?.metadata)
        },
        safely
      })

      const threadMessages: ChatMiddleware = {
        name: THREAD_PLUGIN,
        onStart: () => {
          stoppedWaits.splice(0)
        },
        onChunk: async ({ messages }, chunk) => {
          const eventMessage =
            chunk.type === 'CUSTOM'
              ? await messageOfEvent(chunk.name, chunk.value, sentFiles)
              : undefined

          if (eventMessage !== undefined) {
            await safely(`${chunk.type} post`, () => {
              return postInThread(eventMessage)
            })
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
        onTurnStart: async () => {
          await safely('thread start', openThread)
        },
        middleware: [threadMessages]
      }
    }
  })

  const follow = followChanges({ identityOf, surface, status, openingOf })

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
        status,
        allowedStarters,
        logger,
        lines
      })
    }
  }

  return { plugin, open, follow, linePoster, routes }
}
