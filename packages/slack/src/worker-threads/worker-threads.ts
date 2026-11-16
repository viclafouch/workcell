import { z } from 'zod'
import type { ChatMiddleware } from '@tanstack/ai'
import {
  definePlugin,
  type AnyHarness,
  type HarnessHost,
  type PluginState,
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
import type { LogLine } from '#/connection/bolt-logger.ts'
import type {
  SlackIcon,
  SlackIdentity,
  SlackThread
} from '#/connection/channel-poster.ts'
import type {
  ApprovalClick,
  ThreadRoute
} from '#/connection/slack-connection.ts'
import type { SessionStatus, SlackWeb } from '#/connection/slack-web.ts'
import { readVoice } from '#/plugins/voice.ts'
import {
  SLACK_LINES,
  threadOpeningPrompt,
  type SlackLines
} from '#/prompts/slack.ts'
import {
  approvalContent,
  decidedContent,
  openingContent,
  planContent,
  type WorkerThreadLink
} from './worker-thread-blocks.ts'
import {
  stoppedWait,
  unaskedApprovals,
  waitIdOf,
  waitsOfKind,
  type PostedWait,
  type StoppedWait
} from './worker-waits.ts'

const THREAD_PLUGIN = 'workcell/slack-worker-thread'

const TODO_WRITE = 'todo_write'

const OPENING_LABEL = 'thread-opening'

const SESSION_STATUS = {
  running: 'processing',
  waiting: 'suspended',
  idle: 'active'
} as const satisfies Record<LiveWorker['liveStatus'], SessionStatus>

const threadSchema = z.object({
  slackChannel: z.string(),
  slackThreadTs: z.string()
})

const postedLinesSchema = z.object({
  slackPostedLines: z.array(z.string()).default([])
})

const threadMetadataSchema = workerMetadataSchema.extend({
  ...threadSchema.partial().shape,
  ...postedLinesSchema.partial().shape
})

type OpenedThread = { thread: SlackThread; identity: SlackIdentity }

type WorkerThreadState = { opened?: OpenedThread }

type ThreadPosts = {
  planTs?: string
  askedWaits: string[]
  opening?: { line: string; links: string }
}

export type WorkerProfile = { name: string; title: string; icon?: SlackIcon }

type WorkerLog = { info: LogLine }

type RefreshOpeningParams = {
  web: SlackWeb
  posted: PluginState<ThreadPosts>
  thread: SlackThread
  links: readonly WorkerThreadLink[]
}

type CreateWorkerThreadsParams = {
  web: SlackWeb
  channel: string
  workers: readonly WorkerProfile[]
  allowedStarters: readonly string[]
  logger: { child: (bindings: Record<string, unknown>) => WorkerLog }
  links?: (worker: WorkerMetadata) => readonly WorkerThreadLink[]
  voiceFile?: string
  lines?: SlackLines
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
  web: SlackWeb
  workers: Pick<WorkerThreadRoutesOptions['workers'], 'answerApproval'>
  threadId: string
  channel: string
  log: WorkerLog
  lines: SlackLines
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

function identityOfProfile({ name, icon }: WorkerProfile): SlackIdentity {
  return { username: name, icon }
}

function noLinks(): WorkerThreadLink[] {
  return []
}

export function threadOf(metadata: unknown): SlackThread | undefined {
  const parsed = threadSchema.safeParse(metadata)

  return parsed.success
    ? { channel: parsed.data.slackChannel, threadTs: parsed.data.slackThreadTs }
    : undefined
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
  { web, workers, threadId, channel, log, lines }: ClickAnswerOptions,
  { user, waitId, answer, ts, asked, tell }: ApprovalClick
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
  await web.edit({
    channel,
    ts,
    ...decidedContent({ asked, answer, user, lines })
  })
}

function followChanges(
  web: SlackWeb,
  identityOf: (worker: string) => SlackIdentity
) {
  return async (change: WorkerChange) => {
    const thread = threadOf(change.worker)

    if (thread === undefined) {
      return
    }

    const identity = identityOf(change.worker.name)

    if (change.type === 'finished') {
      if (change.worker.report !== undefined) {
        await web.post({ ...thread, identity, markdown: change.worker.report })
      }

      await web.setStatus({ ...thread, status: 'closed', identity })

      return
    }

    await web.setStatus({
      ...thread,
      status: SESSION_STATUS[change.worker.liveStatus],
      identity
    })
  }
}

async function markAsked(
  posted: PluginState<ThreadPosts>,
  waitIds: readonly string[]
) {
  await posted.update((current) => {
    return { ...current, askedWaits: [...current.askedWaits, ...waitIds] }
  })
}

type QuestionTarget = {
  web: SlackWeb
  posted: PluginState<ThreadPosts>
  thread: SlackThread
  identity: SlackIdentity
}

async function postQuestions(
  { web, posted, thread, identity }: QuestionTarget,
  waits: readonly PostedWait[]
) {
  const { askedWaits } = await posted.get()
  const unasked = waits.filter(({ waitId }) => {
    return !askedWaits.includes(waitId)
  })

  for (const { waitId, text } of unasked) {
    // oxlint-disable-next-line no-await-in-loop -- the questions post in order, each one marked asked before the next, so a restart posts none twice
    await web.post({ ...thread, identity, markdown: text })
    // oxlint-disable-next-line no-await-in-loop -- the questions post in order, each one marked asked before the next, so a restart posts none twice
    await markAsked(posted, [waitId])
  }
}

async function refreshOpening({
  web,
  posted,
  thread,
  links
}: RefreshOpeningParams) {
  const { opening } = await posted.get()
  const linksKey = JSON.stringify(links)

  if (opening === undefined || opening.links === linksKey) {
    return
  }

  await web.edit({
    channel: thread.channel,
    ts: thread.threadTs,
    ...openingContent(opening.line, links)
  })
  await posted.update((current) => {
    return { ...current, opening: { ...opening, links: linksKey } }
  })
}

function postLineOnce({
  liveWorkers,
  host,
  harness,
  web,
  identityOf
}: LinePosterOptions & {
  web: SlackWeb
  identityOf: (worker: string) => SlackIdentity
}) {
  return async ({ threadId, inputId, line }: ThreadLine) => {
    const worker = liveWorkers().find((live) => {
      return live.threadId === threadId
    })
    const thread = threadOf(worker)

    if (worker === undefined || thread === undefined) {
      return
    }

    const { slackPostedLines } = postedLinesSchema.parse(worker)

    if (slackPostedLines.includes(inputId)) {
      return
    }

    await web.post({
      ...thread,
      identity: identityOf(worker.name),
      markdown: line
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
                slackPostedLines: [
                  ...postedLinesSchema.parse(entry.metadata).slackPostedLines,
                  inputId
                ]
              }
            }
      }
    })
  }
}

type RouteOfThreadParams = WorkerThreadRoutesOptions & {
  thread: SlackThread
  web: SlackWeb
  allowedStarters: readonly string[]
  logger: { child: (bindings: Record<string, unknown>) => WorkerLog }
  identityOf: (worker: string) => SlackIdentity
  lines: SlackLines
}

function routeOfThread({
  thread,
  liveWorkers,
  workers,
  web,
  allowedStarters,
  logger,
  identityOf,
  lines
}: RouteOfThreadParams): ThreadRoute | undefined {
  const worker = liveWorkers().find((live) => {
    const liveThread = threadOf(live)

    return (
      liveThread?.channel === thread.channel &&
      liveThread.threadTs === thread.threadTs
    )
  })

  if (worker === undefined) {
    return undefined
  }

  const { threadId, name } = worker
  const log = logger.child({ module: 'slack', threadId, worker: name })

  const ignoresColleague = (user: string) => {
    const isColleague = !allowedStarters.includes(user)

    if (isColleague) {
      log.info({ user }, 'a colleague in a worker thread left alone')
    }

    return isColleague
  }

  return {
    reply: async ({ user, text, ts }) => {
      if (ignoresColleague(user)) {
        return
      }

      await workers.messageWorker({
        threadId,
        sender: { id: user },
        inputId: `slack:${thread.channel}:${ts}`,
        message: text
      })
    },
    approve: async (click) => {
      if (ignoresColleague(click.user)) {
        return
      }

      await answerClick(
        { web, workers, threadId, channel: thread.channel, log, lines },
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
        await web.setStatus({
          ...thread,
          status: SESSION_STATUS[worker.liveStatus],
          identity: identityOf(name)
        })
      }
    }
  }
}

export function createWorkerThreads({
  web,
  channel,
  workers: profiles,
  allowedStarters,
  logger,
  links: linksOf = noLinks,
  voiceFile,
  lines = SLACK_LINES
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

      const openThread = async ({ run }: TurnInfo) => {
        const entry = await setupContext.session.indexEntry()
        const metadata = entry?.metadata

        if (metadata === undefined) {
          return
        }

        const profile = profileOf(metadata.name)
        const links = linksOf(metadata)
        const identity = identityOfProfile(profile)
        const openedThread = threadOf(metadata)
        workerThread.opened =
          openedThread === undefined
            ? undefined
            : { thread: openedThread, identity }

        if (openedThread !== undefined) {
          await refreshOpening({ web, posted, thread: openedThread, links })

          return
        }

        const line = `${lines.greeting(profile.title)}\n${await openingLine(run, metadata)}`
        const threadTs = await web.post({
          channel,
          identity,
          ...openingContent(line, links)
        })
        await posted.update((current) => {
          return { ...current, opening: { line, links: JSON.stringify(links) } }
        })
        const thread = { channel, threadTs }
        workerThread.opened = { thread, identity }
        await setupContext.session.updateIndexEntry((current) => {
          return current.metadata === undefined
            ? {}
            : {
                metadata: {
                  ...current.metadata,
                  slackChannel: channel,
                  slackThreadTs: threadTs
                }
              }
        })
        await web.setStatus({
          ...thread,
          status: 'processing',
          identity,
          title: entry?.title,
          initiator: setupContext.session.user?.id
        })
      }

      const showPlan = async () => {
        const todos = todosOf(setupContext.session.snapshot().plugins)

        if (workerThread.opened === undefined || !todos) {
          return
        }

        const { thread, identity } = workerThread.opened
        const content = planContent(todos, lines)
        const { planTs } = await posted.get()

        if (planTs !== undefined) {
          await web.edit({ channel: thread.channel, ts: planTs, ...content })

          return
        }

        const newPlanTs = await web.post({ ...thread, identity, ...content })
        await posted.update((current) => {
          return { ...current, planTs: newPlanTs }
        })
      }

      const postAnswer = async (answer: string) => {
        if (workerThread.opened === undefined || answer === '') {
          return
        }

        const { thread, identity } = workerThread.opened
        await web.post({ ...thread, identity, markdown: answer })
      }

      const askWaits = async (waits: readonly PostedWait[]) => {
        if (workerThread.opened !== undefined) {
          await postQuestions({ web, posted, ...workerThread.opened }, waits)
        }
      }

      const askApprovals = async (waits: readonly PostedWait[]) => {
        if (workerThread.opened === undefined) {
          return
        }

        const { thread, identity } = workerThread.opened
        const { askedWaits } = await posted.get()
        const approvals = unaskedApprovals(waits, askedWaits)

        if (approvals.length === 0) {
          return
        }

        await web.post({
          ...thread,
          identity,
          ...approvalContent({
            worker: identity.username,
            approvals,
            approvers: allowedStarters,
            lines
          })
        })
        await markAsked(posted, approvals.map(waitIdOf))
      }

      const threadMessages: ChatMiddleware = {
        name: THREAD_PLUGIN,
        onStart: () => {
          stoppedWaits.splice(0)
        },
        onChunk: async ({ messages }, chunk) => {
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
          await safely('answer post', () => {
            return postAnswer(joinCutOffAnswer(messages, content).trim())
          })
          await safely('question post', () => {
            return askWaits(waitsOfKind(waits, 'question'))
          })
          await safely('approval post', () => {
            return askApprovals(waitsOfKind(waits, 'approval'))
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

  const follow = followChanges(web, identityOf)

  const linePoster = (options: LinePosterOptions) => {
    return postLineOnce({ ...options, web, identityOf })
  }

  const routes = ({ liveWorkers, workers }: WorkerThreadRoutesOptions) => {
    return (thread: SlackThread) => {
      return routeOfThread({
        thread,
        liveWorkers,
        workers,
        web,
        allowedStarters,
        logger,
        identityOf,
        lines
      })
    }
  }

  return { plugin, follow, linePoster, routes }
}
