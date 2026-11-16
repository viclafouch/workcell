import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi
} from 'vitest'
import { z } from 'zod'
import type { ThreadLine, WakeWorkerParams, WorkerFinish } from '@workcell/core'
import { timersKeepingTheProcessAlive } from '@workcell/core/testing'
import {
  createGithubApi,
  GITHUB_GRAPHQL_URL,
  type StatusContext,
  type WatchedPullRequest
} from '#/api/github-api.ts'
import type { ReviewGate } from '#/pull-requests/pull-request-events.ts'
import {
  createPullRequestWatcher,
  type WatchedWorker
} from '#/pull-requests/pull-request-watcher.ts'

const GITHUB_TOKEN = 'github_pat_watch_test_token'

const VIEWER = 'host-developer'

const REPOSITORY = 'acme/app'

const WORKER = {
  threadId: 'thread-1',
  repository: REPOSITORY,
  subject: 'TASK-1',
  branch: 'task-1-login'
}

const REVIEW_GATE: ReviewGate = {
  context: 'Review gate',
  waitingDescriptions: [
    'Waiting for code-owner approval',
    'Waiting for an approval'
  ]
}

const PULL_REQUEST_URL = 'https://github.com/acme/app/pull/42'

const COLLEAGUE = { __typename: 'User', login: 'colleague' }

const AI_REVIEW_BOT = { __typename: 'Bot', login: 'review-bot' }

const ACTIONS_BOT = { __typename: 'Bot', login: 'github-actions' }

type FakePullRequest = {
  repository: string
  branch: string
  pullRequest: WatchedPullRequest
}

let pullRequests: FakePullRequest[]

let requests: number

let rateLimitedAnswers: number

const RATE_LIMIT_WINDOW = Temporal.Duration.from({ minutes: 10 })

const PAST_THE_RATE_LIMIT = RATE_LIMIT_WINDOW.add({ seconds: 1 })

const MS_PER_SECOND = 1000

const variablesSchema = z.record(z.string(), z.union([z.string(), z.number()]))

function openPullRequest(
  changes: Partial<WatchedPullRequest> = {}
): WatchedPullRequest {
  return {
    number: 42,
    url: PULL_REQUEST_URL,
    merged: false,
    mergeable: 'MERGEABLE',
    headRefOid: 'head-1',
    mergeCommit: null,
    statusCheckRollup: { state: 'SUCCESS' },
    commits: { nodes: [] },
    reviewThreads: { nodes: [] },
    comments: { nodes: [] },
    reviews: { nodes: [] },
    timelineItems: { nodes: [] },
    ...changes
  }
}

function status(
  context: string,
  state: string,
  changes: Partial<StatusContext> = {}
): StatusContext {
  return {
    id: `status-${context}`,
    context,
    state,
    description: null,
    targetUrl: `https://checks.example.com/${context}`,
    isRequired: true,
    ...changes
  }
}

function checks(state: string, ...contexts: StatusContext[]) {
  return {
    statusCheckRollup: { state },
    commits: { nodes: [{ commit: { status: { contexts } } }] }
  }
}

function selectionOf(
  variables: z.infer<typeof variablesSchema>,
  index: number
) {
  const repository = `${variables[`owner${index}`]}/${variables[`name${index}`]}`
  const branch = variables[`branch${index}`]
  const number = variables[`number${index}`]
  const fake = pullRequests.find((candidate) => {
    return (
      candidate.repository === repository &&
      (branch === undefined
        ? candidate.pullRequest.number === number
        : candidate.branch === branch)
    )
  })

  if (number === undefined) {
    return {
      pullRequests: {
        nodes: fake === undefined ? [] : [{ number: fake.pullRequest.number }]
      }
    }
  }

  return { pullRequest: fake?.pullRequest ?? null }
}

const network = setupServer(
  http.post(GITHUB_GRAPHQL_URL, async ({ request }) => {
    requests += 1

    if (request.headers.get('authorization') !== `Bearer ${GITHUB_TOKEN}`) {
      return HttpResponse.json({ message: 'Bad credentials' }, { status: 401 })
    }

    if (rateLimitedAnswers > 0) {
      rateLimitedAnswers -= 1

      const resetAt = Temporal.Now.instant().add(RATE_LIMIT_WINDOW)

      return HttpResponse.json(
        { message: 'API rate limit exceeded' },
        {
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(
              Math.ceil(resetAt.epochMilliseconds / MS_PER_SECOND)
            )
          }
        }
      )
    }

    const { variables } = z
      .object({ variables: variablesSchema })
      .parse(await request.json())
    const count = Object.keys(variables).filter((key) => {
      return key.startsWith('owner')
    }).length
    const data = Object.fromEntries(
      Array.from({ length: count }, (_, index) => {
        return [`pr${index}`, selectionOf(variables, index)]
      })
    )

    return HttpResponse.json({ data: { viewer: { login: VIEWER }, ...data } })
  })
)

type OpenWatcherParams = {
  liveWorkers?: readonly WatchedWorker[]
  finishWorker?: (finish: WorkerFinish) => Promise<boolean>
}

function openWatcher({
  liveWorkers = [WORKER],
  finishWorker = async () => {
    return true
  }
}: OpenWatcherParams = {}) {
  const wakes: WakeWorkerParams[] = []
  const posts: ThreadLine[] = []
  const finishes: WorkerFinish[] = []
  const lines: string[] = []
  const record = (
    { error, ...details }: Record<string, unknown>,
    message: string
  ) => {
    const reason = Error.isError(error) ? ` ${error.message}` : ''
    lines.push(`${message} ${JSON.stringify(details)}${reason}`)
  }
  const watcher = createPullRequestWatcher({
    github: createGithubApi(GITHUB_TOKEN),
    liveWorkers: () => {
      return liveWorkers
    },
    wakeWorker: async (wake) => {
      wakes.push(wake)
    },
    postLine: async (line) => {
      posts.push(line)
    },
    finishWorker: async (finish) => {
      finishes.push(finish)

      return finishWorker(finish)
    },
    reviewGate: REVIEW_GATE,
    pollIntervalMs: 60_000,
    logger: { info: record, error: record }
  })

  return { watcher, wakes, posts, finishes, lines }
}

function serveGithubPerTest() {
  beforeAll(() => {
    network.listen({ onUnhandledFrame: 'error' })
  })

  beforeEach(() => {
    pullRequests = []
    requests = 0
    rateLimitedAnswers = 0
  })

  afterAll(() => {
    network.close()
  })
}

async function pollTwice(watcher: { pollOnce: () => Promise<void> }) {
  await watcher.pollOnce()
  await watcher.pollOnce()
}

function inputIdsAndDeliveries(wakes: WakeWorkerParams[]) {
  return wakes.map(({ inputId, delivery }) => {
    return [inputId, delivery]
  })
}

describe('the events that wake a worker', () => {
  serveGithubPerTest()

  it('calls GitHub only when a live worker has a branch', async () => {
    const { watcher } = openWatcher({
      liveWorkers: [{ threadId: 'thread-2', repository: REPOSITORY }]
    })

    await pollTwice(watcher)

    expect(requests).toBe(0)
  })

  it('wakes the worker once per head commit when its checks turn red, and names its red required statuses', async () => {
    pullRequests = [
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
    const requestsOfTwoPolls = requests
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
      `pull request event sent {"threadId":"thread-1","pullRequest":"${PULL_REQUEST_URL}","kind":"red-check","inputId":"github:acme/app#42:red-check:head-1","action":"wake"}`
    ])
    expect(requestsOfTwoPolls).toBe(2)
    expect(requests).toBe(requestsOfTwoPolls + 1)
  })

  it('sends nothing while the checks are pending', async () => {
    pullRequests = [
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
    pullRequests = [
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
    pullRequests = [
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
    pullRequests = [
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
    pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest(checks('FAILURE'))
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
    pullRequests = [
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
      `pull request event held: the worker runs a turn, the next poll sends it again {"threadId":"thread-1","pullRequest":"${PULL_REQUEST_URL}","kind":"merged","inputId":"github:acme/app#42:merged:merge-1","action":"finish"}`,
      `pull request event sent {"threadId":"thread-1","pullRequest":"${PULL_REQUEST_URL}","kind":"merged","inputId":"github:acme/app#42:merged:merge-1","action":"finish"}`
    ])
  })

  it('sends again at the next poll an event that the worker failed to take', async () => {
    pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest(checks('FAILURE'))
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
      'github:acme/app#42:red-check:head-1',
      'github:acme/app#42:red-check:head-1'
    ])
  })

  it('waits for the end of the GitHub rate limit window, then reads again', async () => {
    pullRequests = [
      {
        repository: REPOSITORY,
        branch: WORKER.branch,
        pullRequest: openPullRequest(checks('FAILURE'))
      }
    ]
    rateLimitedAnswers = 1
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

    expect(requests).toBe(1)

    vi.setSystemTime(Temporal.Now.instant().add(PAST_THE_RATE_LIMIT))
    await pollTwice(watcher)

    expect(requests - 1).toBe(2)
    expect(wakes).toHaveLength(1)
  })
})

describe('the line of a pull request whose checks turn green', () => {
  serveGithubPerTest()

  it('posts one line in its thread once per head commit when its checks turn green, and wakes nothing', async () => {
    const pullRequest = openPullRequest(
      checks('SUCCESS', status('Review gate', 'SUCCESS'))
    )
    pullRequests = [
      { repository: REPOSITORY, branch: WORKER.branch, pullRequest }
    ]
    const { watcher, wakes, posts } = openWatcher()

    await pollTwice(watcher)
    pullRequests = [
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
    pullRequests = [
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
