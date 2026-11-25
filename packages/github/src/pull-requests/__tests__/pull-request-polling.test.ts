import { describe, expect, it, vi } from 'vitest'
import type { WakeWorkerParams, WorkerFinish } from '@workcell/core'
import { testOctokit } from '#/api/__tests__/test-octokit.ts'
import { createGithubApi } from '#/api/github-api.ts'
import { createPullRequestWatcher } from '#/pull-requests/pull-request-watcher.ts'
import {
  GITHUB_TOKEN,
  REPOSITORY,
  WORKER,
  PULL_REQUEST_URL,
  githubFake,
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
    const { watcher, finishes } = openWatcher({ finishWorker })

    await pollTwice(watcher)
    await watcher.pollOnce()

    expect(finishes).toHaveLength(2)
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
      github: createGithubApi(testOctokit(GITHUB_TOKEN)),
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
