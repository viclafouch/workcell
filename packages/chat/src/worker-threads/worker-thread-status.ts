import { AsyncQueuer } from '@tanstack/pacer'
import type { LiveWorker, WorkerSandboxSetupEvent } from '@workcell/core'
import type { LogLine } from '#/connection/chat-logger.ts'
import type {
  ChatIdentity,
  ChatSurface,
  SessionStatus
} from '#/connection/chat-surface.ts'
import type { ChatLines } from '#/prompts/chat.ts'

const STATUS_LINE_RENEWAL_MS = 60_000

const SESSION_STATUS = {
  queued: 'processing',
  running: 'processing',
  waiting: 'suspended',
  idle: 'active'
} as const satisfies Record<LiveWorker['liveStatus'], SessionStatus>

const WAITING_SETUP_STEPS = new Set<WorkerSandboxSetupEvent['step']>([
  'create',
  'clone',
  'setup',
  'restore'
])

type StatusChange = () => Promise<void>

type SetupRenewal = {
  timer: ReturnType<typeof setInterval>
  renewing: Promise<void>
}

type WorkerThread = { threadId: string; worker: string }

type FollowSetupEventsParams = {
  listen: (handler: (event: WorkerSandboxSetupEvent) => void) => void
  readWorkerThread: () => Promise<WorkerThread | undefined>
  safely: (what: string, work: () => Promise<void>) => Promise<void>
}

type CreateThreadStatusParams = {
  surface: ChatSurface
  identityOf: (worker: string) => ChatIdentity
  lines: Pick<ChatLines, 'setupStatus' | 'queuedName'>
  logger: { child: (bindings: Record<string, unknown>) => { error: LogLine } }
}

export function createThreadStatus({
  surface,
  identityOf,
  lines,
  logger
}: CreateThreadStatusParams) {
  const shownLines = new Set<string>()
  const setupRenewals = new Map<string, SetupRenewal>()
  const changeQueues = new Map<string, AsyncQueuer<StatusChange>>()

  const changeQueueOf = (threadId: string) => {
    const known = changeQueues.get(threadId)

    if (known !== undefined) {
      return known
    }

    const queue = new AsyncQueuer<StatusChange>(async (change) => {
      await change()
    })
    changeQueues.set(threadId, queue)

    return queue
  }

  const inOrder = (threadId: string, change: StatusChange) => {
    const done = Promise.withResolvers<null>()
    changeQueueOf(threadId).addItem(async () => {
      try {
        await change()
        done.resolve(null)
      } catch (error) {
        done.reject(error)
      }
    })

    return done.promise
  }

  const showLine = async (threadId: string, line: string, worker: string) => {
    const identity = identityOf(worker)
    shownLines.add(threadId)
    await surface.setStatus(threadId, 'active', identity)
    await surface.setStatusLine(threadId, line, identity)
  }

  const clearLine = async (threadId: string) => {
    const renewal = setupRenewals.get(threadId)
    setupRenewals.delete(threadId)

    if (renewal !== undefined) {
      clearInterval(renewal.timer)
      await renewal.renewing
    }

    if (shownLines.delete(threadId)) {
      await surface.setStatusLine(threadId, '')
    }
  }

  const showLive = async (
    threadId: string,
    { name, liveStatus }: LiveWorker
  ) => {
    if (liveStatus === 'running' && setupRenewals.has(threadId)) {
      return
    }

    await clearLine(threadId)
    const identity = identityOf(name)
    await surface.setStatus(
      threadId,
      SESSION_STATUS[liveStatus],
      liveStatus === 'queued'
        ? { ...identity, name: lines.queuedName(name) }
        : identity
    )
  }

  const close = async (threadId: string, identity: ChatIdentity) => {
    await clearLine(threadId)
    await surface.setStatus(threadId, 'closed', identity)
  }

  const renewSetupLine = async (threadId: string, worker: string) => {
    try {
      await surface.setStatusLine(
        threadId,
        lines.setupStatus,
        identityOf(worker)
      )
    } catch (error) {
      logger
        .child({ module: 'chat', threadId, worker })
        .error({ error }, 'setup status not renewed')
    }
  }

  const showSetup = async (threadId: string, worker: string) => {
    if (setupRenewals.has(threadId)) {
      return
    }

    const renewal: SetupRenewal = {
      timer: setInterval(() => {
        renewal.renewing = renewSetupLine(threadId, worker)
      }, STATUS_LINE_RENEWAL_MS).unref(),
      renewing: Promise.resolve()
    }
    setupRenewals.set(threadId, renewal)
    await showLine(threadId, lines.setupStatus, worker)
  }

  const endSetup = async (threadId: string, worker: string) => {
    if (!setupRenewals.has(threadId)) {
      return
    }

    await clearLine(threadId)
    await surface.setStatus(threadId, 'processing', identityOf(worker))
  }

  const followSetup = async (
    event: WorkerSandboxSetupEvent,
    threadId: string,
    worker: string
  ) => {
    if (event.step === 'done') {
      await endSetup(threadId, worker)

      return
    }

    if (WAITING_SETUP_STEPS.has(event.step)) {
      await showSetup(threadId, worker)
    }
  }

  const followSetupEvents = ({
    listen,
    readWorkerThread,
    safely
  }: FollowSetupEventsParams) => {
    const setupEvents = new AsyncQueuer(
      async (event: WorkerSandboxSetupEvent) => {
        await safely('setup status', async () => {
          const workerThread = await readWorkerThread()

          if (workerThread !== undefined) {
            const { threadId, worker } = workerThread
            await inOrder(threadId, () => {
              return followSetup(event, threadId, worker)
            })
          }
        })
      }
    )
    listen((event) => {
      setupEvents.addItem(event)
    })
  }

  return {
    followSetupEvents,
    showLine: async (threadId: string, line: string, worker: string) => {
      await inOrder(threadId, () => {
        return showLine(threadId, line, worker)
      })
    },
    showLive: async (threadId: string, worker: LiveWorker) => {
      await inOrder(threadId, () => {
        return showLive(threadId, worker)
      })
    },
    close: async (threadId: string, identity: ChatIdentity) => {
      await inOrder(threadId, () => {
        return close(threadId, identity)
      })
      changeQueues.delete(threadId)
    }
  }
}

export type ThreadStatus = ReturnType<typeof createThreadStatus>
