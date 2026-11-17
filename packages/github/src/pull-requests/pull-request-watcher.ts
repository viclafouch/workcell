import { setTimeout } from 'node:timers/promises'
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
import {
  failedCheckRunCount,
  pullRequestEvents,
  type PullRequestEvent,
  type ReviewGate
} from './pull-request-events.ts'

type LogLine = (details: Record<string, unknown>, message: string) => void

export type WatchedWorker = {
  threadId: string
  repository: string
  subject?: string
  branch?: string
  pullRequest?: string
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
}

type WorkerOnABranch = WatchedWorker & { branch: string }

function matchIsOnABranch(worker: WatchedWorker): worker is WorkerOnABranch {
  return worker.branch !== undefined
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
  personChecks
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
      case 'finish': {
        return finishWorker({ threadId, report: action.report })
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

  const headOf = ({
    threadId,
    repository,
    branch
  }: WorkerOnABranch): PullRequestHead => {
    return { repository, branch, number: pullRequestNumbers.get(threadId) }
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

      const events = pullRequestEvents({
        repository: worker.repository,
        pullRequest,
        viewerLogin,
        subject: worker.subject,
        lines,
        reviewGate,
        // oxlint-disable-next-line no-await-in-loop -- the failed jobs read shares the paced budget of the poll
        failedJobs: await failedJobsOf(worker, pullRequest, redHeadsRead),
        personChecks
      })

      for (const event of events) {
        const isSent =
          sentInputIds.has(event.inputId) ||
          // oxlint-disable-next-line no-await-in-loop -- the events of a pull request reach the worker in order
          (await send(worker.threadId, pullRequest.url, event))

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
