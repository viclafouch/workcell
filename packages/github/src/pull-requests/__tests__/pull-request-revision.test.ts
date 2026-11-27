import { describe, expect, it } from 'vitest'
import {
  REPOSITORY,
  WORKER,
  PULL_REQUEST_URL,
  githubFake,
  openPullRequest,
  status,
  checks,
  openWatcher,
  serveGithubPerTest,
  pollTwice
} from './pull-request-watcher-fixtures.ts'

const PULL_REQUEST_STATES_SEEN = 3

describe('the changes of a pull request that a person watches', () => {
  serveGithubPerTest()

  it('records a new revision each time the pull request changes, and none while it stays the same', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest(checks('PENDING'))
      }
    ]
    const { watcher, revisions } = openWatcher({
      liveWorkers: [{ ...WORKER, pullRequest: PULL_REQUEST_URL }]
    })

    await pollTwice(watcher)
    const whilePending = [...revisions]
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest(
          checks('SUCCESS', status('deploy/preview', 'SUCCESS'))
        )
      }
    ]
    await pollTwice(watcher)
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest({
          ...checks('SUCCESS', status('deploy/preview', 'SUCCESS')),
          merged: true,
          closed: true,
          mergeCommit: { oid: 'merge-1' }
        })
      }
    ]
    await watcher.pollOnce()

    expect(whilePending).toHaveLength(1)
    expect(revisions).toHaveLength(PULL_REQUEST_STATES_SEEN)
    expect(new Set(revisions).size).toBe(PULL_REQUEST_STATES_SEEN)
  })

  it('records a new revision when a person edits the pull request, such as its labels or its reviewers', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest({
          ...checks('PENDING'),
          updatedAt: '2026-11-20T09:00:00Z'
        })
      }
    ]
    const { watcher, revisions } = openWatcher({
      liveWorkers: [{ ...WORKER, pullRequest: PULL_REQUEST_URL }]
    })

    await watcher.pollOnce()
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest({
          ...checks('PENDING'),
          updatedAt: '2026-11-20T09:05:00Z'
        })
      }
    ]
    await watcher.pollOnce()

    expect(new Set(revisions).size).toBe(2)
  })

  it('records no revision after a restart when the pull request did not change', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest(checks('PENDING'))
      }
    ]
    const before = openWatcher({
      liveWorkers: [{ ...WORKER, pullRequest: PULL_REQUEST_URL }]
    })
    await before.watcher.pollOnce()
    const [recorded] = before.revisions

    const after = openWatcher({
      liveWorkers: [
        {
          ...WORKER,
          pullRequest: PULL_REQUEST_URL,
          pullRequestRevision: recorded
        }
      ]
    })
    await pollTwice(after.watcher)

    expect(recorded).toBeTypeOf('string')
    expect(after.revisions).toStrictEqual([])
  })

  it('records the revision again at the next poll when the store refuses the write', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest(checks('PENDING'))
      }
    ]
    const { watcher, revisions, lines } = openWatcher({
      liveWorkers: [{ ...WORKER, pullRequest: PULL_REQUEST_URL }],
      refusedUpdates: 1
    })

    await pollTwice(watcher)

    expect(revisions).toHaveLength(1)
    expect(lines[0]).toBe(
      `pull request revision not recorded: the next poll records it again {"threadId":"thread-1","pullRequest":"${PULL_REQUEST_URL}"} The store is down.`
    )
  })
})
