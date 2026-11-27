import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import { z } from 'zod'
import type { StatusState } from '@octokit/graphql-schema'
import type {
  ThreadLine,
  UpdateWorkerParams,
  WakeWorkerParams,
  WorkerFinish
} from '@workcell/core'
import { testOctokit } from '#/api/__tests__/test-octokit.ts'
import {
  createGithubApi,
  type Author,
  type StatusContext,
  type WatchedPullRequest
} from '#/api/github-api.ts'
import type { ReviewGate } from '#/pull-requests/pull-request-events.ts'
import {
  createPullRequestWatcher,
  type WatchedWorker
} from '#/pull-requests/pull-request-watcher.ts'

export const GITHUB_TOKEN = 'github_pat_watch_test_token'

const GITHUB_API = 'https://api.github.com'

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

export const EARLIER = '2026-11-20T09:00:00Z'

export const LATER = '2026-11-20T11:00:00Z'

export function lastCommitAt(committedDate: string) {
  return { nodes: [{ commit: { committedDate, status: null } }] }
}

export const COLLEAGUE: Author = { __typename: 'User', login: 'colleague' }

export const AI_REVIEW_BOT: Author = { __typename: 'Bot', login: 'review-bot' }

export const ACTIONS_BOT: Author = {
  __typename: 'Bot',
  login: 'github-actions'
}

type FakePullRequest = {
  repository: string
  branch: string
  pullRequest: WatchedPullRequest
}

type FakeJob = { name: string; conclusion: string | null; html_url: string }

type FakeWorkflowRun = {
  id: number
  workflow_id: number
  event: string
  head_sha: string
  conclusion: string | null
  jobs: FakeJob[]
}

type GithubFake = {
  pullRequests: FakePullRequest[]
  workflowRuns: FakeWorkflowRun[]
  requests: number
  actionsReads: string[]
  actionsRefused: boolean
}

export const githubFake: GithubFake = {
  pullRequests: [],
  workflowRuns: [],
  requests: 0,
  actionsReads: [],
  actionsRefused: false
}

const variablesSchema = z.record(z.string(), z.union([z.string(), z.number()]))

export function openPullRequest(
  changes: Partial<WatchedPullRequest> = {}
): WatchedPullRequest {
  return {
    number: 42,
    url: PULL_REQUEST_URL,
    merged: false,
    closed: false,
    mergeable: 'MERGEABLE',
    headRefOid: 'head-1',
    updatedAt: '2026-11-20T09:00:00Z',
    mergeCommit: null,
    statusCheckRollup: rollup('SUCCESS'),
    commits: { nodes: [] },
    reviewThreads: { nodes: [] },
    comments: { nodes: [] },
    reviews: { nodes: [] },
    timelineItems: { nodes: [] },
    isDraft: false,
    mergeStateStatus: 'CLEAN',
    isInMergeQueue: false,
    isMergeQueueEnabled: false,
    reviewDecision: null,
    reviewRequests: { nodes: [] },
    baseRepository: { viewerDefaultMergeMethod: 'SQUASH' },
    ...changes
  }
}

export function status(
  context: string,
  state: StatusState,
  changes: Partial<StatusContext> = {}
): StatusContext {
  return {
    id: `status-${context}`,
    context,
    state,
    description: null,
    targetUrl: `https://checks.example.com/${context}`,
    ...changes
  }
}

export function rollup(
  state: StatusState,
  failedCheckRuns = 0
): WatchedPullRequest['statusCheckRollup'] {
  return {
    state,
    contexts: {
      checkRunCountsByState: [
        { state: 'CANCELLED', count: 2 },
        { state: 'FAILURE', count: failedCheckRuns },
        { state: 'SUCCESS', count: 5 }
      ]
    }
  }
}

export function checks(state: StatusState, ...contexts: StatusContext[]) {
  return {
    statusCheckRollup: rollup(state),
    commits: {
      nodes: [{ commit: { committedDate: EARLIER, status: { contexts } } }]
    }
  }
}

type FakeRun = {
  workflow: string
  event?: string
  conclusion: string | null
  jobs?: { name: string; conclusion: string | null }[]
}

export function workflowRuns(...runs: FakeRun[]): FakeWorkflowRun[] {
  const workflows = [
    ...new Set(
      runs.map(({ workflow }) => {
        return workflow
      })
    )
  ]

  return runs.map(
    ({ workflow, event = 'pull_request', conclusion, jobs = [] }, index) => {
      const id = index + 1

      return {
        id,
        workflow_id: workflows.indexOf(workflow) + 1,
        event,
        head_sha: 'head-1',
        conclusion,
        jobs: jobs.map((job) => {
          return {
            ...job,
            html_url: `https://github.com/acme/app/actions/runs/${id}/job/${encodeURIComponent(job.name)}`
          }
        })
      }
    }
  )
}

function actionsRead(request: Request) {
  const { pathname, search } = new URL(request.url)
  githubFake.actionsReads.push(`${pathname}${search}`)

  return request.headers.get('authorization') === `token ${GITHUB_TOKEN}` &&
    !githubFake.actionsRefused
    ? undefined
    : HttpResponse.json(
        { message: 'Resource not accessible by personal access token' },
        { status: 403 }
      )
}

function selectionOf(
  variables: z.infer<typeof variablesSchema>,
  index: number
) {
  const repository = `${variables[`owner${index}`]}/${variables[`name${index}`]}`
  const branch = variables[`branch${index}`]
  const number = variables[`number${index}`]
  const fake = githubFake.pullRequests.find(
    ({
      repository: candidateRepository,
      branch: candidateBranch,
      pullRequest
    }) => {
      const isClosedUnmerged = pullRequest.closed && !pullRequest.merged

      return (
        candidateRepository === repository &&
        (branch === undefined
          ? pullRequest.number === number
          : candidateBranch === branch && !isClosedUnmerged)
      )
    }
  )

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
  http.get(`${GITHUB_API}/repos/acme/app/actions/runs`, ({ request }) => {
    const headSha = new URL(request.url).searchParams.get('head_sha')

    return (
      actionsRead(request) ??
      HttpResponse.json({
        workflow_runs: githubFake.workflowRuns
          .filter(({ head_sha }) => {
            return head_sha === headSha
          })
          .map(({ jobs, ...run }) => {
            return run
          })
      })
    )
  }),
  http.get(
    `${GITHUB_API}/repos/acme/app/actions/runs/:runId/jobs`,
    ({ request, params }) => {
      const run = githubFake.workflowRuns.find(({ id }) => {
        return String(id) === params.runId
      })

      return (
        actionsRead(request) ?? HttpResponse.json({ jobs: run?.jobs ?? [] })
      )
    }
  ),
  http.post(`${GITHUB_API}/graphql`, async ({ request }) => {
    githubFake.requests += 1

    if (request.headers.get('authorization') !== `token ${GITHUB_TOKEN}`) {
      return HttpResponse.json({ message: 'Bad credentials' }, { status: 401 })
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
  maxRedRounds?: number
  merge?: boolean
}

export function openWatcher({
  liveWorkers = [WORKER],
  finishWorker = async () => {
    return true
  },
  refusedUpdates = 0,
  maxRedRounds,
  merge
}: OpenWatcherParams = {}) {
  let updatesToRefuse = refusedUpdates
  const workers = [...liveWorkers]
  const updates: UpdateWorkerParams[] = []
  const revisions: unknown[] = []
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
    github: createGithubApi(testOctokit(GITHUB_TOKEN)),
    liveWorkers: () => {
      return workers
    },
    updateWorker: async (update) => {
      if (updatesToRefuse > 0) {
        updatesToRefuse -= 1

        throw new Error('The store is down.')
      }

      const { pullRequestRevision } = update.metadata

      if (pullRequestRevision === undefined) {
        updates.push(update)
      } else {
        revisions.push(pullRequestRevision)
      }

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
    personChecks: ['Validate risk'],
    maxRedRounds,
    merge,
    pollIntervalMs: 60_000,
    logger: { info: record, error: record }
  })

  return { watcher, updates, revisions, wakes, posts, finishes, lines }
}

export function serveGithubPerTest() {
  beforeAll(() => {
    network.listen({ onUnhandledFrame: 'error' })
  })

  beforeEach(() => {
    githubFake.pullRequests = []
    githubFake.workflowRuns = []
    githubFake.actionsReads = []
    githubFake.actionsRefused = false
    githubFake.requests = 0
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
