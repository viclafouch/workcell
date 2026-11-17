import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import { z } from 'zod'
import type {
  ThreadLine,
  UpdateWorkerParams,
  WakeWorkerParams,
  WorkerFinish
} from '@workcell/core'
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

export const GITHUB_TOKEN = 'github_pat_watch_test_token'

export const VIEWER = 'host-developer'

export const REPOSITORY = 'acme/app'

export const WORKER = {
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

export const PULL_REQUEST_URL = 'https://github.com/acme/app/pull/42'

export const COLLEAGUE = { __typename: 'User', login: 'colleague' }

export const AI_REVIEW_BOT = { __typename: 'Bot', login: 'review-bot' }

export const ACTIONS_BOT = { __typename: 'Bot', login: 'github-actions' }

type FakePullRequest = {
  repository: string
  branch: string
  pullRequest: WatchedPullRequest
}

type GithubFake = {
  pullRequests: FakePullRequest[]
  requests: number
  rateLimitedAnswers: number
}

export const githubFake: GithubFake = {
  pullRequests: [],
  requests: 0,
  rateLimitedAnswers: 0
}

const RATE_LIMIT_WINDOW = Temporal.Duration.from({ minutes: 10 })

export const PAST_THE_RATE_LIMIT = RATE_LIMIT_WINDOW.add({ seconds: 1 })

const MS_PER_SECOND = 1000

const variablesSchema = z.record(z.string(), z.union([z.string(), z.number()]))

export function openPullRequest(
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

export function status(
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

export function checks(state: string, ...contexts: StatusContext[]) {
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
  const fake = githubFake.pullRequests.find((candidate) => {
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
        nodes:
          fake === undefined
            ? []
            : [{ number: fake.pullRequest.number, url: fake.pullRequest.url }]
      }
    }
  }

  return { pullRequest: fake?.pullRequest ?? null }
}

const network = setupServer(
  http.post(GITHUB_GRAPHQL_URL, async ({ request }) => {
    githubFake.requests += 1

    if (request.headers.get('authorization') !== `Bearer ${GITHUB_TOKEN}`) {
      return HttpResponse.json({ message: 'Bad credentials' }, { status: 401 })
    }

    if (githubFake.rateLimitedAnswers > 0) {
      githubFake.rateLimitedAnswers -= 1

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
  refusedUpdates?: number
}

export function openWatcher({
  liveWorkers = [WORKER],
  finishWorker = async () => {
    return true
  },
  refusedUpdates = 0
}: OpenWatcherParams = {}) {
  let updatesToRefuse = refusedUpdates
  const workers = [...liveWorkers]
  const updates: UpdateWorkerParams[] = []
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
      return workers
    },
    updateWorker: async (update) => {
      if (updatesToRefuse > 0) {
        updatesToRefuse -= 1

        throw new Error('The store is down.')
      }

      updates.push(update)
      const index = workers.findIndex(({ threadId }) => {
        return threadId === update.threadId
      })
      const worker = workers[index]

      if (worker !== undefined) {
        workers[index] = { ...worker, ...update.metadata }
      }
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

  return { watcher, updates, wakes, posts, finishes, lines }
}

export function serveGithubPerTest() {
  beforeAll(() => {
    network.listen({ onUnhandledFrame: 'error' })
  })

  beforeEach(() => {
    githubFake.pullRequests = []
    githubFake.requests = 0
    githubFake.rateLimitedAnswers = 0
  })

  afterAll(() => {
    network.close()
  })
}

export async function pollTwice(watcher: { pollOnce: () => Promise<void> }) {
  await watcher.pollOnce()
  await watcher.pollOnce()
}

export function inputIdsAndDeliveries(wakes: WakeWorkerParams[]) {
  return wakes.map(({ inputId, delivery }) => {
    return [inputId, delivery]
  })
}
