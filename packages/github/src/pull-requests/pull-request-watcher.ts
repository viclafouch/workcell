import { setTimeout } from 'node:timers/promises'
import { z } from 'zod'
import {
  startLoop,
  type ThreadLine,
  type UpdateWorkerParams,
  type WakeWorkerParams,
  type WorkerFinish
} from '@workcell/core'
import type {
  FailedJob,
  GithubApi,
  PullRequestHead,
  WatchedPullRequest
} from '#/api/github-api.ts'
import type { PullRequestLines } from '#/prompts/github.ts'
import { mergeMetadataSchema } from './merge-metadata.ts'
import {
  failedCheckRunCount,
  pullRequestEvents,
  type PullRequestEvent,
  type ReviewGate
} from './pull-request-events.ts'
import { revisionOf } from './pull-request-revision.ts'

type LogLine = (details: Record<string, unknown>, message: string) => void

export type WatchedWorker = {
  threadId: string
  repository: string
  subject?: string
  branch?: string
  pullRequest?: string
  pullRequestRevision?: unknown
  redCommits?: unknown
  mergeCommand?: unknown
  mergeRefusal?: unknown
  starterId?: string
}

type PullRequestWatcherParams = {
  github: GithubApi
  liveWorkers: () => readonly WatchedWorker[]
  updateWorker: (update: UpdateWorkerParams) => Promise<void>
  wakeWorker: (wake: WakeWorkerParams) => Promise<void>
  postLine: (line: ThreadLine) => Promise<void>
  finishWorker: (finish: WorkerFinish) => Promise<boolean>
  pollIntervalMs: number
  logger: { info: LogLine; error: LogLine }
  lines?: PullRequestLines
  reviewGate?: ReviewGate
  personChecks?: readonly string[]
  maxRedRounds?: number
  merge?: boolean
}

type WorkerOnABranch = WatchedWorker & { branch: string }

const redCommitsSchema = z.array(z.string())

function redCommitsOf({ redCommits }: WatchedWorker) {
  return redCommitsSchema.safeParse(redCommits).data ?? []
}

const PULL_REQUEST_PATH = /\/pull\/(?<number>\d+)$/u

function recordedNumberOf(pullRequest: string | undefined) {
  const number = pullRequest?.match(PULL_REQUEST_PATH)?.groups?.number

  return number === undefined ? undefined : Number(number)
}

function matchIsOnABranch(worker: WatchedWorker): worker is WorkerOnABranch {
  return worker.branch !== undefined
}

type ClearStaleMergeCommandParams = Pick<
  PullRequestWatcherParams,
  'updateWorker' | 'logger'
> & {
  worker: WatchedWorker
  events: readonly PullRequestEvent[]
}

async function clearStaleMergeCommand({
  updateWorker,
  logger,
  worker: { threadId, mergeCommand },
  events
}: ClearStaleMergeCommandParams) {
  const isStillReady = events.some(({ action }) => {
    return action.type === 'merge'
  })

  if (mergeCommand === undefined || isStillReady) {
    return
  }

  try {
    await updateWorker({ threadId, metadata: { mergeCommand: undefined } })
  } catch (error) {
    logger.error(
      { threadId, error },
      'merge command not cleared: the next poll clears it again'
    )
  }
}

type RecordRevisionParams = Pick<
  PullRequestWatcherParams,
  'updateWorker' | 'logger'
> & {
  worker: WatchedWorker
  pullRequest: WatchedPullRequest
}

async function recordRevision({
  updateWorker,
  logger,
  worker: { threadId, pullRequestRevision: recorded },
  pullRequest
}: RecordRevisionParams) {
  const pullRequestRevision = revisionOf(pullRequest)

  if (recorded === pullRequestRevision) {
    return
  }

  try {
    await updateWorker({ threadId, metadata: { pullRequestRevision } })
  } catch (error) {
    logger.error(
      { threadId, pullRequest: pullRequest.url, error },
      'pull request revision not recorded: the next poll records it again'
    )
  }
}

export function createPullRequestWatcher({
  github,
  liveWorkers,
  updateWorker,
  wakeWorker,
  postLine,
  finishWorker,
  pollIntervalMs,
  logger,
  lines,
  reviewGate,
  personChecks,
  maxRedRounds,
  merge
}: PullRequestWatcherParams) {
  const pullRequestNumbers = new Map<string, number>()
  let sentInputIds = new Set<string>()
  let failedJobsByRedHead = new Map<string, readonly FailedJob[]>()

  const handle = async (
    threadId: string,
    { inputId, action }: PullRequestEvent
  ) => {
    switch (action.type) {
      case 'wake': {
        const { delivery, message } = action
        await wakeWorker({ threadId, inputId, message, delivery })

        return true
      }
      case 'post': {
        await postLine({ threadId, inputId, line: action.line })

        return true
      }
      case 'merge': {
        await updateWorker({
          threadId,
          metadata: { mergeCommand: action.command }
        })
        await wakeWorker({
          threadId,
          inputId,
          message: action.message,
          delivery: 'followUp'
        })

        return true
      }
      case 'finish': {
        return finishWorker({
          threadId,
          report: action.report,
          outcome: action.outcome
        })
      }
    }
  }

  const send = async (
    threadId: string,
    pullRequestUrl: string,
    event: PullRequestEvent
  ) => {
    const { kind, inputId, action } = event
    const details = { threadId, pullRequest: pullRequestUrl, kind, inputId }

    try {
      const isHandled = await handle(threadId, event)
      logger.info(
        { ...details, action: action.type },
        isHandled
          ? 'pull request event sent'
          : 'pull request event held: the worker runs a turn, the next poll sends it again'
      )

      return isHandled
    } catch (error) {
      logger.error(
        { ...details, error },
        'pull request event not sent: the next poll sends it again'
      )

      return false
    }
  }

  const recordPullRequest = async (
    { threadId, pullRequest: recorded }: WatchedWorker,
    pullRequest: string
  ) => {
    if (recorded === pullRequest) {
      return
    }

    try {
      await updateWorker({ threadId, metadata: { pullRequest } })
      logger.info({ threadId, pullRequest }, 'pull request recorded')
    } catch (error) {
      logger.error(
        { threadId, pullRequest, error },
        'pull request not recorded: the next poll records it again'
      )
    }
  }

  const failedJobsOf = async (
    { threadId, repository }: WatchedWorker,
    pullRequest: WatchedPullRequest,
    redHeadsRead: Map<string, readonly FailedJob[]>
  ) => {
    const failedCheckRuns = failedCheckRunCount(pullRequest)

    if (failedCheckRuns === 0) {
      return []
    }

    const { headRefOid, url } = pullRequest
    const redHead = `${repository}:${headRefOid}:${failedCheckRuns}`

    try {
      const failedJobs =
        failedJobsByRedHead.get(redHead) ??
        (await github.readFailedJobs({ repository, headSha: headRefOid }))
      redHeadsRead.set(redHead, failedJobs)

      return failedJobs
    } catch (error) {
      logger.error(
        { threadId, pullRequest: url, error },
        'failed jobs not read: the next poll reads them again'
      )

      return []
    }
  }

  const recordRedCommit = async (
    worker: WatchedWorker,
    { redCommit }: PullRequestEvent
  ) => {
    const { threadId } = worker
    const redCommits = redCommitsOf(worker)

    if (redCommit === undefined || redCommits.includes(redCommit)) {
      return true
    }

    try {
      await updateWorker({
        threadId,
        metadata: { redCommits: [...redCommits, redCommit] }
      })

      return true
    } catch (error) {
      logger.error(
        { threadId, redCommit, error },
        'red commit not recorded: the next poll records it again'
      )

      return false
    }
  }

  const headOf = ({
    threadId,
    repository,
    branch,
    pullRequest
  }: WorkerOnABranch): PullRequestHead => {
    return {
      repository,
      branch,
      number: pullRequestNumbers.get(threadId) ?? recordedNumberOf(pullRequest)
    }
  }

  const pollOnce = async () => {
    const workers = liveWorkers().filter(matchIsOnABranch)

    if (workers.length === 0) {
      return
    }

    const { viewerLogin, reads } = await github.readPullRequests(
      workers.map(headOf)
    )
    const sentAndStillVisible = new Set<string>()
    const redHeadsRead = new Map<string, readonly FailedJob[]>()

    for (const [index, read] of reads.entries()) {
      const worker = workers[index]

      if (worker === undefined || !read.found) {
        continue
      }

      pullRequestNumbers.set(worker.threadId, read.number)
      // oxlint-disable-next-line no-await-in-loop -- the pull request is recorded before its events reach the worker
      await recordPullRequest(worker, read.url)
      const { pullRequest } = read

      if (pullRequest === undefined) {
        continue
      }

      // oxlint-disable-next-line no-await-in-loop -- the revision is recorded before the events of the pull request reach the worker
      await recordRevision({ updateWorker, logger, worker, pullRequest })

      const events = pullRequestEvents({
        repository: worker.repository,
        pullRequest,
        viewerLogin,
        subject: worker.subject,
        lines,
        reviewGate,
        // oxlint-disable-next-line no-await-in-loop -- the failed jobs read shares the paced budget of the poll
        failedJobs: await failedJobsOf(worker, pullRequest, redHeadsRead),
        personChecks,
        merge,
        mergeRefusal: mergeMetadataSchema.safeParse(worker).data?.mergeRefusal,
        starterId: worker.starterId,
        redCommits:
          maxRedRounds === undefined
            ? undefined
            : {
                max: maxRedRounds,
                recorded: redCommitsOf(worker)
              }
      })

      // oxlint-disable-next-line no-await-in-loop -- a stale command is cleared before the events reach the worker
      await clearStaleMergeCommand({ updateWorker, logger, worker, events })

      for (const event of events) {
        const isSent =
          sentInputIds.has(event.inputId) ||
          // oxlint-disable-next-line no-await-in-loop -- the events of a pull request reach the worker in order
          ((await recordRedCommit(worker, event)) &&
            // oxlint-disable-next-line no-await-in-loop -- the red round is recorded before its event reaches the worker
            (await send(worker.threadId, pullRequest.url, event)))

        if (isSent) {
          sentAndStillVisible.add(event.inputId)
        }
      }
    }

    const watchedThreads = new Set(
      workers.map(({ threadId }) => {
        return threadId
      })
    )

    for (const threadId of pullRequestNumbers.keys()) {
      if (!watchedThreads.has(threadId)) {
        pullRequestNumbers.delete(threadId)
      }
    }

    sentInputIds = sentAndStillVisible
    failedJobsByRedHead = redHeadsRead
  }

  const run = async (signal: AbortSignal) => {
    while (!signal.aborted) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- the poll reads once per interval
        await pollOnce()
      } catch (error) {
        logger.error({ error }, 'pull request poll failed')
      }

      // oxlint-disable-next-line no-await-in-loop -- the poll waits between two reads
      await setTimeout(pollIntervalMs, null, { signal }).catch(() => {
        return null
      })
    }
  }

  return {
    pollOnce,
    start: () => {
      return startLoop(run)
    }
  }
}
