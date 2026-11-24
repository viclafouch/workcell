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
  rollup,
  workflowRuns,
  openWatcher,
  serveGithubPerTest,
  pollTwice,
  inputIdsAndDeliveries,
  EARLIER,
  LATER,
  lastCommitAt
} from './pull-request-watcher-fixtures.ts'

function redOn(headRefOid: string) {
  return [
    {
      repository: REPOSITORY,
      branch: WORKER.branch,
      pullRequest: openPullRequest({
        ...checks('FAILURE', status('code/scan', 'FAILURE')),
        headRefOid
      })
    }
  ]
}

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
        pullRequest: openPullRequest(
          checks('FAILURE', status('code/scan', 'FAILURE'))
        )
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
      ['github:acme/app#42:red-check:head-1:code/scan', 'steer']
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
                      createdAt: EARLIER,
                      author: AI_REVIEW_BOT
                    },
                    {
                      id: 'own-reply-1',
                      url: `${PULL_REQUEST_URL}#thread-2`,
                      createdAt: EARLIER,
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
                      createdAt: EARLIER,
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
                createdAt: EARLIER,
                author: COLLEAGUE
              },
              {
                id: 'risk-score-1',
                url: `${PULL_REQUEST_URL}#c2`,
                createdAt: EARLIER,
                author: ACTIONS_BOT
              }
            ]
          },
          reviews: {
            nodes: [
              {
                id: 'review-1',
                url: `${PULL_REQUEST_URL}#v1`,
                createdAt: EARLIER,
                author: COLLEAGUE,
                state: 'CHANGES_REQUESTED',
                body: ''
              },
              {
                id: 'summary-1',
                url: `${PULL_REQUEST_URL}#v2`,
                createdAt: EARLIER,
                author: AI_REVIEW_BOT,
                state: 'COMMENTED',
                body: 'No finding.'
              },
              {
                id: 'approval-1',
                url: `${PULL_REQUEST_URL}#v3`,
                createdAt: EARLIER,
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
})

describe('the outcome of the task of a pull request', () => {
  serveGithubPerTest()

  it('ends the worker of a merged pull request as a success, with a report that names the pull request and the subject, and wakes nothing', async () => {
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
        report: `Merged: ${PULL_REQUEST_URL}\nSubject: TASK-1`,
        outcome: { value: 'success' }
      }
    ])
  })

  it('ends the worker of a merged pull request as flawed when it pushed a commit after a person asked for a change', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest({
          merged: true,
          mergeCommit: { oid: 'merge-1' },
          commits: lastCommitAt(LATER),
          reviews: {
            nodes: [
              {
                id: 'review-1',
                url: `${PULL_REQUEST_URL}#v1`,
                createdAt: EARLIER,
                author: COLLEAGUE,
                state: 'CHANGES_REQUESTED',
                body: ''
              }
            ]
          }
        })
      }
    ]
    const { watcher, finishes } = openWatcher()

    await pollTwice(watcher)

    expect(finishes).toMatchObject([{ outcome: { value: 'flawed' } }])
  })

  it('ends the worker of a merged pull request as a success when no commit follows the comment of a person, and a commit follows only an approval or a bot finding', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest({
          merged: true,
          mergeCommit: { oid: 'merge-1' },
          commits: lastCommitAt(EARLIER),
          reviewThreads: {
            nodes: [
              {
                isResolved: true,
                comments: {
                  nodes: [
                    {
                      id: 'finding-1',
                      url: `${PULL_REQUEST_URL}#thread-1`,
                      createdAt: '2026-11-20T08:00:00Z',
                      author: AI_REVIEW_BOT
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
                createdAt: LATER,
                author: COLLEAGUE
              }
            ]
          },
          reviews: {
            nodes: [
              {
                id: 'approval-1',
                url: `${PULL_REQUEST_URL}#v1`,
                createdAt: '2026-11-20T08:00:00Z',
                author: COLLEAGUE,
                state: 'APPROVED',
                body: 'Nice.'
              }
            ]
          }
        })
      }
    ]
    const { watcher, finishes } = openWatcher()

    await pollTwice(watcher)

    expect(finishes).toMatchObject([{ outcome: { value: 'success' } }])
  })

  it('ends the worker of the pull request it recorded as manual once a person closes it unmerged, and wakes nothing', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest({ closed: true, ...checks('FAILURE') })
      }
    ]
    const { watcher, wakes, finishes } = openWatcher({
      liveWorkers: [{ ...WORKER, pullRequest: PULL_REQUEST_URL }]
    })

    await pollTwice(watcher)

    expect(wakes).toStrictEqual([])
    expect(finishes).toStrictEqual([
      {
        threadId: WORKER.threadId,
        report: `Closed unmerged: ${PULL_REQUEST_URL}\nSubject: TASK-1`,
        outcome: {
          value: 'manual',
          cause: 'A person closed the pull request unmerged.'
        }
      }
    ])
  })

  it('ends no worker on an older pull request of its branch that a person closed before the worker recorded it', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest({ closed: true })
      }
    ]
    const { watcher, updates, finishes } = openWatcher()

    await pollTwice(watcher)

    expect(updates).toStrictEqual([])
    expect(finishes).toStrictEqual([])
  })
})

describe('the red checks of a pull request', () => {
  serveGithubPerTest()

  it('wakes the worker once per head commit with its failed statuses and the failed jobs of the latest run of each workflow, read once', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest({
          ...checks(
            'FAILURE',
            status('code/scan', 'FAILURE'),
            status('license/scan', 'ERROR'),
            status('Review gate', 'PENDING')
          ),
          statusCheckRollup: rollup('FAILURE', 2)
        })
      }
    ]
    githubFake.workflowRuns = workflowRuns(
      {
        workflow: 'tests',
        event: 'push',
        conclusion: 'failure',
        jobs: [{ name: 'e2e', conclusion: 'failure' }]
      },
      {
        workflow: 'tests',
        conclusion: 'failure',
        jobs: [{ name: 'unit tests', conclusion: 'failure' }]
      },
      { workflow: 'tests', conclusion: 'success' },
      {
        workflow: 'code',
        conclusion: 'cancelled',
        jobs: [
          { name: 'lint', conclusion: 'failure' },
          { name: 'build', conclusion: 'cancelled' }
        ]
      },
      { workflow: 'docs', conclusion: 'success' }
    )
    const { watcher, wakes, lines } = openWatcher()

    await pollTwice(watcher)
    const requestsOfTwoPolls = githubFake.requests
    await watcher.pollOnce()

    expect(wakes).toStrictEqual([
      {
        threadId: WORKER.threadId,
        inputId:
          'github:acme/app#42:red-check:head-1:code/scan,license/scan,lint,e2e',
        delivery: 'steer',
        message: `The pull request watcher sends this, not a person. The checks of the pull request ${PULL_REQUEST_URL} failed on head-1. The status "code/scan" failed: https://checks.example.com/code/scan. The status "license/scan" failed: https://checks.example.com/license/scan. The job "lint" failed: https://github.com/acme/app/actions/runs/4/job/lint. The job "e2e" failed: https://github.com/acme/app/actions/runs/1/job/e2e. Read the log of a failed job with gh run view --job <job> --log-failed, where <job> ends its link. Push a fix, or ask with the question tool when you cannot fix it. Then end your turn.`
      }
    ])
    expect(lines).toStrictEqual([
      `pull request recorded {"threadId":"thread-1","pullRequest":"${PULL_REQUEST_URL}"}`,
      `pull request event sent {"threadId":"thread-1","pullRequest":"${PULL_REQUEST_URL}","kind":"red-check","inputId":"github:acme/app#42:red-check:head-1:code/scan,license/scan,lint,e2e","action":"wake"}`
    ])
    expect(githubFake.actionsReads.toSorted()).toStrictEqual([
      '/repos/acme/app/actions/runs/1/jobs?filter=latest&per_page=100',
      '/repos/acme/app/actions/runs/4/jobs?filter=latest&per_page=100',
      '/repos/acme/app/actions/runs?head_sha=head-1&exclude_pull_requests=true&per_page=100'
    ])
    expect(requestsOfTwoPolls).toBe(2)
    expect(githubFake.requests).toBe(requestsOfTwoPolls + 1)
  })

  it('wakes the worker again on the same head commit when another check fails', async () => {
    const redStatus = openPullRequest(
      checks('FAILURE', status('code/scan', 'FAILURE'))
    )
    githubFake.pullRequests = [
      { repository: REPOSITORY, branch: WORKER.branch, pullRequest: redStatus }
    ]
    const { watcher, wakes } = openWatcher()

    await pollTwice(watcher)
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: { ...redStatus, statusCheckRollup: rollup('FAILURE', 1) }
      }
    ]
    githubFake.workflowRuns = workflowRuns({
      workflow: 'tests',
      conclusion: 'failure',
      jobs: [{ name: 'unit tests', conclusion: 'failure' }]
    })
    await pollTwice(watcher)

    expect(inputIdsAndDeliveries(wakes)).toStrictEqual([
      ['github:acme/app#42:red-check:head-1:code/scan', 'steer'],
      ['github:acme/app#42:red-check:head-1:code/scan,unit tests', 'steer']
    ])
  })

  it('asks a person past its cap of red rounds instead of waking the worker, with the rounds it recorded before a restart', async () => {
    githubFake.pullRequests = redOn('head-1')
    const { watcher, wakes, posts, updates } = openWatcher({
      liveWorkers: [{ ...WORKER, redCommits: ['head-0'] }],
      maxRedRounds: 2
    })

    await pollTwice(watcher)
    githubFake.pullRequests = redOn('head-2')
    await pollTwice(watcher)

    expect(inputIdsAndDeliveries(wakes)).toStrictEqual([
      ['github:acme/app#42:red-check:head-1:code/scan', 'steer']
    ])
    expect(posts).toStrictEqual([
      {
        threadId: WORKER.threadId,
        inputId: 'github:acme/app#42:red-round-cap:head-2',
        line: `Checks failed 3 times on ${PULL_REQUEST_URL}: I stop fixing them until a person tells me to go on.`
      }
    ])
    expect(updates.slice(1)).toStrictEqual([
      {
        threadId: WORKER.threadId,
        metadata: { redCommits: ['head-0', 'head-1'] }
      },
      {
        threadId: WORKER.threadId,
        metadata: { redCommits: ['head-0', 'head-1', 'head-2'] }
      }
    ])
  })

  it('wakes no one and reads no job when the checks are red from cancelled runs only', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest(checks('FAILURE'))
      }
    ]
    githubFake.workflowRuns = workflowRuns({
      workflow: 'tests',
      conclusion: 'cancelled',
      jobs: [{ name: 'unit tests', conclusion: 'cancelled' }]
    })
    const { watcher, wakes, posts } = openWatcher()

    await pollTwice(watcher)

    expect(wakes).toStrictEqual([])
    expect(posts).toStrictEqual([])
    expect(githubFake.actionsReads).toStrictEqual([])
  })

  it('posts a line for a failed check that a person clears, and wakes no worker', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest({
          ...checks('FAILURE'),
          statusCheckRollup: rollup('FAILURE', 1)
        })
      }
    ]
    githubFake.workflowRuns = workflowRuns({
      workflow: 'risk',
      conclusion: 'failure',
      jobs: [{ name: 'Validate risk', conclusion: 'failure' }]
    })
    const { watcher, wakes, posts } = openWatcher()

    await pollTwice(watcher)

    expect(wakes).toStrictEqual([])
    expect(posts).toStrictEqual([
      {
        threadId: WORKER.threadId,
        inputId: 'github:acme/app#42:person-check:head-1:Validate risk',
        line: `Validate risk failed on ${PULL_REQUEST_URL}, a person clears it: https://github.com/acme/app/actions/runs/1/job/Validate%20risk`
      }
    ])
  })

  it('names the failed statuses when GitHub refuses the jobs, and reads the jobs again at the next poll', async () => {
    githubFake.pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest({
          ...checks('FAILURE', status('code/scan', 'FAILURE')),
          statusCheckRollup: rollup('FAILURE', 1)
        })
      }
    ]
    githubFake.actionsRefused = true
    const { watcher, wakes, lines } = openWatcher()

    await pollTwice(watcher)
    const actionsReadsOfTwoPolls = [...githubFake.actionsReads]
    await watcher.pollOnce()

    expect(
      wakes.map(({ message }) => {
        return message
      })
    ).toStrictEqual([
      `The pull request watcher sends this, not a person. The checks of the pull request ${PULL_REQUEST_URL} failed on head-1. The status "code/scan" failed: https://checks.example.com/code/scan. Read the log of a failed job with gh run view --job <job> --log-failed, where <job> ends its link. Push a fix, or ask with the question tool when you cannot fix it. Then end your turn.`
    ])
    expect(lines[1]).toBe(
      `failed jobs not read: the next poll reads them again {"threadId":"thread-1","pullRequest":"${PULL_REQUEST_URL}"} Resource not accessible by personal access token`
    )
    expect(actionsReadsOfTwoPolls).toHaveLength(1)
    expect(githubFake.actionsReads).toHaveLength(2)
  })
})
