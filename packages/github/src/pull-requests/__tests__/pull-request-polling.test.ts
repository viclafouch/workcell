import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { WakeWorkerParams, WorkerFinish } from '@workcell/core'
import { timersKeepingTheProcessAlive } from '@workcell/core/testing'
import { createGithubApi } from '#/api/github-api.ts'
import { createPullRequestWatcher } from '#/pull-requests/pull-request-watcher.ts'
import {
  GITHUB_TOKEN,
  REPOSITORY,
  WORKER,
  PULL_REQUEST_URL,
  githubFake,
  PAST_THE_RATE_LIMIT,
  openPullRequest,
  status,
  checks,
  openWatcher,
  serveGithubPerTest,
  pollTwice,
  inputIdsAndDeliveries
} from './pull-request-watcher-fixtures.ts'

describe('the pull request watch', () => {
  serveGithubPerTest()

  it('leaves no timer behind once its GitHub API is disposed', async () => {
    const timersBefore = timersKeepingTheProcessAlive()
    const github = createGithubApi(GITHUB_TOKEN)

    await github.readPullRequests([
      { repository: REPOSITORY, branch: WORKER.branch, number: undefined }
    ])
    const timersAfterTheCall = timersKeepingTheProcessAlive()
    github[Symbol.dispose]()

    expect(timersAfterTheCall).toBeGreaterThan(timersBefore)
    expect(timersKeepingTheProcessAlive()).toBeLessThanOrEqual(timersBefore)
  })

  it('sends again after a host restart the same input ids, so the worker store drops the duplicates', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest(
          checks('FAILURE', status('code/scan', 'FAILURE'))
        )
      }
    ]
    const before = openWatcher()
    await pollTwice(before.watcher)
    const after = openWatcher()

    await pollTwice(after.watcher)

    expect(inputIdsAndDeliveries(after.wakes)).toStrictEqual(
      inputIdsAndDeliveries(before.wakes)
    )
  })

  it('ends at the next poll a merged worker that ran a turn at the first one', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest({
          merged: true,
          mergeCommit: { oid: 'merge-1' }
        })
      }
    ]
    const finishWorker = vi
      .fn<(finish: WorkerFinish) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    const { watcher, finishes, lines } = openWatcher({ finishWorker })

    await pollTwice(watcher)
    await watcher.pollOnce()

    expect(finishes).toHaveLength(2)
    expect(lines).toStrictEqual([
      `pull request recorded {"threadId":"thread-1","pullRequest":"${PULL_REQUEST_URL}"}`,
      `pull request event held: the worker runs a turn, the next poll sends it again {"threadId":"thread-1","pullRequest":"${PULL_REQUEST_URL}","kind":"merged","inputId":"github:acme/app#42:merged:merge-1","action":"finish"}`,
      `pull request event sent {"threadId":"thread-1","pullRequest":"${PULL_REQUEST_URL}","kind":"merged","inputId":"github:acme/app#42:merged:merge-1","action":"finish"}`
    ])
  })

  it('sends again at the next poll an event that the worker failed to take', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest(
          checks('FAILURE', status('code/scan', 'FAILURE'))
        )
      }
    ]
    const wakeWorker = vi
      .fn<(wake: WakeWorkerParams) => Promise<void>>()
      .mockRejectedValueOnce(new Error('The store is down.'))
      .mockResolvedValue()
    const watcher = createPullRequestWatcher({
      github: createGithubApi(GITHUB_TOKEN),
      liveWorkers: () => {
        return [WORKER]
      },
      updateWorker: async () => {},
      wakeWorker,
      postLine: async () => {},
      finishWorker: async () => {
        return true
      },
      pollIntervalMs: 60_000,
      logger: { info: () => {}, error: () => {} }
    })

    await pollTwice(watcher)
    await watcher.pollOnce()

    expect(
      wakeWorker.mock.calls.map(([{ inputId }]) => {
        return inputId
      })
    ).toStrictEqual([
      'github:acme/app#42:red-check:head-1:code/scan',
      'github:acme/app#42:red-check:head-1:code/scan'
    ])
  })

  it('waits for the end of the GitHub rate limit window, then reads again', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest(
          checks('FAILURE', status('code/scan', 'FAILURE'))
        )
      }
    ]
    githubFake.rateLimitedAnswers = 1
    vi.useFakeTimers({ toFake: ['Date', 'Temporal'] })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const { watcher, wakes } = openWatcher()

    await expect(watcher.pollOnce()).rejects.toThrow(
      'GitHub rate limits the pull request watch until'
    )
    await expect(watcher.pollOnce()).rejects.toThrow(
      'GitHub rate limits the pull request watch until'
    )

    expect(githubFake.requests).toBe(1)

    vi.setSystemTime(Temporal.Now.instant().add(PAST_THE_RATE_LIMIT))
    await pollTwice(watcher)

    expect(githubFake.requests - 1).toBe(2)
    expect(wakes).toHaveLength(1)
  })
})

describe('the line of a pull request whose checks turn green', () => {
  serveGithubPerTest()

  it('posts one line in its thread once per head commit when its checks turn green, and wakes nothing', async () => {
    const pullRequest = openPullRequest(
      checks('SUCCESS', status('Review gate', 'SUCCESS'))
    )
    githubFake.pullRequests = [
      { repository: REPOSITORY, branch: WORKER.branch, pullRequest }
    ]
    const { watcher, wakes, posts } = openWatcher()

    await pollTwice(watcher)
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: { ...pullRequest, headRefOid: 'head-2' }
      }
    ]
    await pollTwice(watcher)

    expect(wakes).toStrictEqual([])
    expect(posts).toStrictEqual([
      {
        threadId: WORKER.threadId,
        inputId: 'github:acme/app#42:green-check:head-1',
        line: `Checks green: ${PULL_REQUEST_URL}`
      },
      {
        threadId: WORKER.threadId,
        inputId: 'github:acme/app#42:green-check:head-2',
        line: `Checks green: ${PULL_REQUEST_URL}`
      }
    ])
  })

  it('posts the green line of a head commit with the same input id after a host restart, so the thread drops the duplicate', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest(checks('SUCCESS'))
      }
    ]
    const before = openWatcher()
    await pollTwice(before.watcher)
    const after = openWatcher()

    await pollTwice(after.watcher)

    expect(after.posts).toStrictEqual(before.posts)
    expect(before.posts).toHaveLength(1)
  })
})
