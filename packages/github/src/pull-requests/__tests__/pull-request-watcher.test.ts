import { describe, expect, it } from 'vitest'
import {
  VIEWER,
  REPOSITORY,
  WORKER,
  PULL_REQUEST_URL,
  COLLEAGUE,
  AI_REVIEW_BOT,
  ACTIONS_BOT,
  githubFake,
  openPullRequest,
  status,
  checks,
  openWatcher,
  serveGithubPerTest,
  pollTwice,
  inputIdsAndDeliveries
} from './pull-request-watcher-fixtures.ts'

describe('the pull request of a worker', () => {
  serveGithubPerTest()

  it('records the pull request of its branch once, also one that a person opened by hand', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest()
      }
    ]
    const { watcher, updates } = openWatcher()

    await pollTwice(watcher)
    await watcher.pollOnce()

    expect(updates).toStrictEqual([
      {
        threadId: WORKER.threadId,
        metadata: { pullRequest: PULL_REQUEST_URL }
      }
    ])
  })

  it('records the pull request at the next poll when the store refuses the first write, and still sends its events', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest(checks('FAILURE'))
      }
    ]
    const { watcher, updates, wakes, lines } = openWatcher({
      refusedUpdates: 1
    })

    await watcher.pollOnce()
    const updatesAfterTheRefusal = [...updates]
    await pollTwice(watcher)

    expect(updatesAfterTheRefusal).toStrictEqual([])
    expect(updates).toStrictEqual([
      {
        threadId: WORKER.threadId,
        metadata: { pullRequest: PULL_REQUEST_URL }
      }
    ])
    expect(lines[0]).toBe(
      `pull request not recorded: the next poll records it again {"threadId":"thread-1","pullRequest":"${PULL_REQUEST_URL}"} The store is down.`
    )
    expect(inputIdsAndDeliveries(wakes)).toStrictEqual([
      ['github:acme/app#42:red-check:head-1', 'steer']
    ])
  })

  it('records nothing for a worker that holds its pull request already, after a restart', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest()
      }
    ]
    const { watcher, updates } = openWatcher({
      liveWorkers: [{ ...WORKER, pullRequest: PULL_REQUEST_URL }]
    })

    await pollTwice(watcher)

    expect(updates).toStrictEqual([])
  })

  it('records nothing before the branch has a pull request', async () => {
    const { watcher, updates } = openWatcher()

    await pollTwice(watcher)

    expect(updates).toStrictEqual([])
  })
})

describe('the events that wake a worker', () => {
  serveGithubPerTest()

  it('calls GitHub only when a live worker has a branch', async () => {
    const { watcher } = openWatcher({
      liveWorkers: [{ threadId: 'thread-2', repository: REPOSITORY }]
    })

    await pollTwice(watcher)

    expect(githubFake.requests).toBe(0)
  })

  it('wakes the worker once per head commit when its checks turn red, and names its red required statuses', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest(
          checks(
            'FAILURE',
            status('code/scan', 'FAILURE'),
            status('license/scan', 'FAILURE', { isRequired: false }),
            status('Review gate', 'PENDING')
          )
        )
      }
    ]
    const { watcher, wakes, lines } = openWatcher()

    await pollTwice(watcher)
    const requestsOfTwoPolls = githubFake.requests
    await watcher.pollOnce()

    expect(wakes).toStrictEqual([
      {
        threadId: WORKER.threadId,
        inputId: 'github:acme/app#42:red-check:head-1',
        delivery: 'steer',
        message: `The checks of the pull request ${PULL_REQUEST_URL} are red on head-1. The required status "code/scan" failed: https://checks.example.com/code/scan. Read the failed GitHub Actions jobs with gh run list --commit head-1, then gh run view <run> --log-failed. Push a fix, or ask with the question tool when you cannot fix it. Then end your turn.`
      }
    ])
    expect(lines).toStrictEqual([
      `pull request recorded {"threadId":"thread-1","pullRequest":"${PULL_REQUEST_URL}"}`,
      `pull request event sent {"threadId":"thread-1","pullRequest":"${PULL_REQUEST_URL}","kind":"red-check","inputId":"github:acme/app#42:red-check:head-1","action":"wake"}`
    ])
    expect(requestsOfTwoPolls).toBe(2)
    expect(githubFake.requests).toBe(requestsOfTwoPolls + 1)
  })

  it('sends nothing while the checks are pending', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest(
          checks('PENDING', status('code/scan', 'FAILURE'))
        )
      }
    ]
    const { watcher, wakes, posts } = openWatcher()

    await pollTwice(watcher)

    expect(wakes).toStrictEqual([])
    expect(posts).toStrictEqual([])
  })

  it('wakes the worker on a comment of a colleague or a bot finding, and skips its own comments and the bot summaries', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest({
          reviewThreads: {
            nodes: [
              {
                isResolved: false,
                comments: {
                  nodes: [
                    {
                      id: 'finding-1',
                      url: `${PULL_REQUEST_URL}#thread-1`,
                      author: AI_REVIEW_BOT
                    },
                    {
                      id: 'own-reply-1',
                      url: `${PULL_REQUEST_URL}#thread-2`,
                      author: { __typename: 'User', login: VIEWER }
                    }
                  ]
                }
              },
              {
                isResolved: true,
                comments: {
                  nodes: [
                    {
                      id: 'resolved-1',
                      url: `${PULL_REQUEST_URL}#thread-3`,
                      author: COLLEAGUE
                    }
                  ]
                }
              }
            ]
          },
          comments: {
            nodes: [
              {
                id: 'comment-1',
                url: `${PULL_REQUEST_URL}#c1`,
                author: COLLEAGUE
              },
              {
                id: 'risk-score-1',
                url: `${PULL_REQUEST_URL}#c2`,
                author: ACTIONS_BOT
              }
            ]
          },
          reviews: {
            nodes: [
              {
                id: 'review-1',
                url: `${PULL_REQUEST_URL}#v1`,
                author: COLLEAGUE,
                state: 'CHANGES_REQUESTED',
                body: ''
              },
              {
                id: 'summary-1',
                url: `${PULL_REQUEST_URL}#v2`,
                author: AI_REVIEW_BOT,
                state: 'COMMENTED',
                body: 'No finding.'
              },
              {
                id: 'approval-1',
                url: `${PULL_REQUEST_URL}#v3`,
                author: COLLEAGUE,
                state: 'APPROVED',
                body: 'Nice.'
              }
            ]
          }
        })
      }
    ]
    const { watcher, wakes } = openWatcher()

    await pollTwice(watcher)

    expect(inputIdsAndDeliveries(wakes)).toStrictEqual([
      ['github:acme/app#42:review-comment:finding-1', 'steer'],
      ['github:acme/app#42:comment:comment-1', 'steer'],
      ['github:acme/app#42:review:review-1', 'steer']
    ])
  })

  it('wakes the worker on a conflict, a Review gate that waits on an owner, and a merge queue ejection, and posts the merge queue entry in its thread once', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest({
          mergeable: 'CONFLICTING',
          ...checks(
            'PENDING',
            status('Review gate', 'PENDING', {
              description: 'Waiting for code-owner approval from @acme/devops.'
            })
          ),
          timelineItems: {
            nodes: [
              { __typename: 'AddedToMergeQueueEvent', id: 'queued-1' },
              {
                __typename: 'RemovedFromMergeQueueEvent',
                id: 'ejected-1',
                reason: 'Failed checks'
              }
            ]
          }
        })
      }
    ]
    const { watcher, wakes, posts } = openWatcher()

    await pollTwice(watcher)

    expect(inputIdsAndDeliveries(wakes)).toStrictEqual([
      ['github:acme/app#42:conflict:head-1', 'steer'],
      [
        'github:acme/app#42:review-gate:head-1:Waiting for code-owner approval from @acme/devops.',
        'followUp'
      ],
      ['github:acme/app#42:merge-queue-ejection:ejected-1', 'steer']
    ])
    expect(posts).toStrictEqual([
      {
        threadId: WORKER.threadId,
        inputId: 'github:acme/app#42:merge-queue-entry:queued-1',
        line: `In the merge queue: ${PULL_REQUEST_URL}`
      }
    ])
  })

  it('ends the worker of a merged pull request with a report that names the pull request and the subject, and wakes nothing', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest({
          merged: true,
          mergeCommit: { oid: 'merge-1' },
          ...checks('FAILURE')
        })
      }
    ]
    const { watcher, wakes, posts, finishes } = openWatcher()

    await pollTwice(watcher)

    expect(wakes).toStrictEqual([])
    expect(posts).toStrictEqual([])
    expect(finishes).toStrictEqual([
      {
        threadId: WORKER.threadId,
        report: `Merged: ${PULL_REQUEST_URL}\nSubject: TASK-1`
      }
    ])
  })
})
