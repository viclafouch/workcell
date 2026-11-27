import type {
  HarnessHost,
  HostStatusEvent,
  SessionIndexEntry
} from '@tanstack/ai-harness'
import { AsyncQueuer } from '@tanstack/pacer'
import { startLoop } from '#/host/loop.ts'
import {
  workerMetadataSchema,
  type WorkerMetadata
} from '#/session/metadata.ts'
import type { WorkerHarness } from './harness.ts'
import type { WorkerLifecycle, WorkerLogger } from './lifecycle.ts'

export type ListedWorker = WorkerMetadata &
  Pick<SessionIndexEntry, 'threadId' | 'updatedAt' | 'usage'> & {
    starterId?: string
  }

export type LiveStatus = HostStatusEvent['status'] | 'queued'

export type LiveWorker = ListedWorker & { liveStatus: LiveStatus }

export type WorkerChange =
  | { type: 'status'; worker: LiveWorker }
  | { type: 'finished'; worker: ListedWorker }

export type OnWorkerChange = (change: WorkerChange) => void | Promise<void>

type TrackWorkerChangesParams = {
  host: HarnessHost
  harness: WorkerHarness
  readWorkers: () => Promise<ListedWorker[]>
  lifecycle: Pick<WorkerLifecycle, 'isQueued' | 'onQueueChange'>
  logger: WorkerLogger
  onChange: OnWorkerChange
}

export function listedWorkerOf({
  threadId,
  updatedAt,
  usage,
  members,
  metadata
}: SessionIndexEntry): ListedWorker | undefined {
  const parsed = workerMetadataSchema.safeParse(metadata)
  const starterId = members.find(({ role }) => {
    return role === 'owner'
  })?.userId

  return parsed.success
    ? { threadId, updatedAt, usage, starterId, ...parsed.data }
    : undefined
}

export async function trackWorkerChanges({
  host,
  harness,
  readWorkers,
  lifecycle,
  logger,
  onChange
}: TrackWorkerChangesParams) {
  const live = new Map<string, ListedWorker>()
  const statuses = new Map<string, LiveStatus>()
  const firstListing = Promise.withResolvers<null>()
  const log = logger.child({ module: 'agents' })

  const liveWorkerOf = (worker: ListedWorker): LiveWorker => {
    const liveStatus = lifecycle.isQueued(worker.threadId)
      ? 'queued'
      : (statuses.get(worker.threadId) ?? 'idle')

    return { ...worker, liveStatus }
  }

  const changes = new AsyncQueuer(async (change: WorkerChange) => {
    try {
      await onChange(change)
    } catch (error) {
      log.error(
        { error, threadId: change.worker.threadId },
        'worker change not handled'
      )
    }
  })

  const readOnce = async (signal: AbortSignal) => {
    const changedThreads = new Set<string>()

    const remember = (threadId: string, worker: ListedWorker) => {
      changedThreads.add(threadId)
      live.set(threadId, worker)
    }

    const forget = (threadId: string) => {
      changedThreads.add(threadId)
      live.delete(threadId)
    }

    const finish = (threadId: string, entry: SessionIndexEntry) => {
      const previous = live.get(threadId)
      forget(threadId)
      statuses.delete(threadId)

      if (previous !== undefined) {
        changes.addItem({
          type: 'finished',
          worker: listedWorkerOf(entry) ?? previous
        })
      }
    }

    const followEntry = (threadId: string, entry: SessionIndexEntry) => {
      if (entry.archived === true) {
        finish(threadId, entry)

        return
      }

      const worker = listedWorkerOf(entry)

      if (worker === undefined) {
        forget(threadId)

        return
      }

      remember(threadId, worker)
    }

    const readEvents = async () => {
      for await (const event of host.events({ signal })) {
        if (event.type === 'session' && event.entry.harness === harness.name) {
          followEntry(event.threadId, event.entry)
        }

        if (event.type === 'session-deleted') {
          forget(event.threadId)
        }

        if (event.type === 'status') {
          statuses.set(event.threadId, event.status)
          const worker = live.get(event.threadId)

          if (worker !== undefined) {
            changes.addItem({ type: 'status', worker: liveWorkerOf(worker) })
          }
        }
      }
    }

    const reading = readEvents()
    const listedWorkers = await readWorkers()
    const listed = new Map(
      listedWorkers.map((worker) => {
        return [worker.threadId, worker]
      })
    )

    for (const threadId of live.keys()) {
      if (!listed.has(threadId) && !changedThreads.has(threadId)) {
        live.delete(threadId)
      }
    }

    for (const [threadId, worker] of listed) {
      if (!changedThreads.has(threadId)) {
        live.set(threadId, worker)
      }
    }

    firstListing.resolve(null)
    await reading
  }

  const tellQueueChange = (threadId: string) => {
    const worker = live.get(threadId)

    if (worker !== undefined) {
      changes.addItem({ type: 'status', worker: liveWorkerOf(worker) })
    }
  }

  const keepReading = async (signal: AbortSignal) => {
    const stopTelling = lifecycle.onQueueChange(tellQueueChange)

    try {
      while (!signal.aborted) {
        // oxlint-disable-next-line no-await-in-loop -- each read starts when the one before it ends
        await readOnce(signal)
      }
    } catch (error) {
      firstListing.reject(error)
      log.error({ error }, 'live workers no longer tracked')
    } finally {
      stopTelling()
    }
  }

  const reading = startLoop(keepReading)
  await firstListing.promise

  return {
    liveWorkers: () => {
      return live.values().map(liveWorkerOf).toArray()
    },
    [Symbol.asyncDispose]: reading[Symbol.asyncDispose]
  }
}
