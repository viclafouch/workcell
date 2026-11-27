import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished
} from 'vitest'
import { z } from 'zod'
import { testOctokit } from '#/api/__tests__/test-octokit.ts'
import { githubPullRequests } from '#/pull-requests/pull-request-details.ts'

const GITHUB_TOKEN = 'github_pat_details'

const HEAD = 'a1b2c3d4e5f60000000000000000000000000000'

const CHECK_RUN_COUNT = 5

const MERGE_COMMIT = 'c0ffee0000000000000000000000000000000000'

const PULL_REQUEST_DIFF =
  'diff --git a/src/login.ts b/src/login.ts\n-old\n+new\n'

const OPEN = {
  number: 7,
  title: 'Fix the login',
  body: 'The button logs in now.',
  url: 'https://github.com/acme/app/pull/7',
  state: 'OPEN',
  isDraft: false,
  mergedAt: null,
  mergedBy: null,
  mergeCommit: null,
  closedAt: null,
  author: { login: 'octocat', avatarUrl: 'https://avatars/octocat' },
  assignees: {
    nodes: [{ login: 'octocat', avatarUrl: 'https://avatars/octocat' }]
  },
  labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
  reviewRequests: {
    nodes: [
      {
        requestedReviewer: {
          __typename: 'User',
          login: 'monalisa',
          avatarUrl: 'https://avatars/monalisa'
        }
      },
      { requestedReviewer: { __typename: 'Team', name: 'Frontend' } }
    ]
  },
  latestReviews: {
    nodes: [
      {
        state: 'CHANGES_REQUESTED',
        author: { login: 'hubot', avatarUrl: 'https://avatars/hubot' }
      },
      {
        state: 'DISMISSED',
        author: { login: 'ghost', avatarUrl: 'https://avatars/ghost' }
      }
    ]
  },
  mergeStateStatus: 'BLOCKED',
  isInMergeQueue: false,
  updatedAt: '2026-11-27T15:00:00Z',
  comments: { totalCount: 2 },
  commitCount: { totalCount: 3 },
  baseRefName: 'main',
  headRefName: 'fix-login',
  headRefOid: HEAD,
  additions: 12,
  deletions: 3,
  changedFiles: 2,
  files: {
    nodes: [
      {
        path: 'src/login.ts',
        changeType: 'MODIFIED',
        additions: 10,
        deletions: 3
      },
      {
        path: 'src/login.test.ts',
        changeType: 'ADDED',
        additions: 2,
        deletions: 0
      }
    ]
  },
  commits: {
    nodes: [
      {
        commit: {
          status: {
            contexts: [
              {
                context: 'deploy/preview',
                state: 'SUCCESS',
                targetUrl: 'https://preview.example/7',
                description: 'Preview ready'
              }
            ]
          },
          statusCheckRollup: { contexts: { checkRunCount: CHECK_RUN_COUNT } }
        }
      }
    ]
  }
}

const NO_CHECKS = {
  nodes: [{ commit: { status: null, statusCheckRollup: null } }]
}

const OPEN_NUMBER = 7

const DRAFT_NUMBER = 8

const MERGED_NUMBER = 9

const CLOSED_NUMBER = 10

const QUEUED_NUMBER = 11

const PULL_REQUESTS = new Map<number, unknown>([
  [OPEN_NUMBER, OPEN],
  [
    QUEUED_NUMBER,
    {
      ...OPEN,
      number: QUEUED_NUMBER,
      isInMergeQueue: true,
      mergeStateStatus: 'CLEAN'
    }
  ],
  [DRAFT_NUMBER, { ...OPEN, number: DRAFT_NUMBER, isDraft: true }],
  [
    MERGED_NUMBER,
    {
      ...OPEN,
      number: MERGED_NUMBER,
      state: 'MERGED',
      mergedAt: '2026-11-27T15:59:42Z',
      mergedBy: { login: 'hubot', avatarUrl: 'https://avatars/hubot' },
      mergeCommit: { oid: MERGE_COMMIT },
      closedAt: '2026-11-27T15:59:42Z',
      commits: NO_CHECKS
    }
  ],
  [
    CLOSED_NUMBER,
    {
      ...OPEN,
      number: CLOSED_NUMBER,
      state: 'CLOSED',
      closedAt: '2026-11-26T10:00:00Z',
      commits: NO_CHECKS
    }
  ]
])

type FakeJob = { name: string; conclusion: string | null; attempt?: number }

const FAKE_RUNS = [
  {
    id: 'older-lint',
    workflow_id: 1,
    run_attempt: 1,
    jobs: [{ name: 'Lint', conclusion: 'failure' }]
  },
  {
    id: 'lint',
    workflow_id: 1,
    run_attempt: 2,
    jobs: [
      { name: 'Lint', conclusion: 'failure' },
      { name: 'Lint', conclusion: 'success', attempt: 2 }
    ]
  },
  {
    id: 'test',
    workflow_id: 2,
    run_attempt: 1,
    jobs: [{ name: 'Test', conclusion: null }]
  }
] satisfies {
  id: string
  workflow_id: number
  run_attempt: number
  jobs: FakeJob[]
}[]

const RUNS = FAKE_RUNS.map(({ id, workflow_id, run_attempt }, index) => {
  return {
    id: index + 1,
    workflow_id,
    event: 'pull_request',
    run_attempt,
    name: id
  }
})

const jobUrl = (run: string, index: number) => {
  return `https://github.com/acme/app/actions/runs/${run}/job/${index}`
}

const JOBS = new Map(
  FAKE_RUNS.map(({ id, jobs }, runIndex) => {
    return [
      String(runIndex + 1),
      jobs.map(({ name, conclusion, attempt = 1 }: FakeJob, index) => {
        return {
          name,
          status: conclusion === null ? 'in_progress' : 'completed',
          conclusion,
          run_attempt: attempt,
          html_url: jobUrl(id, index)
        }
      })
    ]
  })
)

const graphqlSchema = z.object({
  variables: z.object({
    owner: z.string(),
    name: z.string(),
    number: z.number()
  })
})

const fakeActions = { isRefused: false }

const refusedActions = () => {
  return HttpResponse.json(
    { message: 'Resource not accessible by personal access token' },
    { status: 403 }
  )
}

const network = setupServer(
  http.post('https://api.github.com/graphql', async ({ request }) => {
    const { variables } = graphqlSchema.parse(await request.json())
    const pullRequest = PULL_REQUESTS.get(variables.number)

    return pullRequest === undefined
      ? HttpResponse.json({
          data: { repository: { pullRequest: null } },
          errors: [
            {
              type: 'NOT_FOUND',
              path: ['repository', 'pullRequest'],
              message: `Could not resolve to a PullRequest with the number of ${variables.number}.`
            }
          ]
        })
      : HttpResponse.json({ data: { repository: { pullRequest } } })
  }),
  http.get(
    'https://api.github.com/repos/acme/app/actions/runs',
    ({ request }) => {
      if (fakeActions.isRefused) {
        return refusedActions()
      }

      const headSha = new URL(request.url).searchParams.get('head_sha')

      return HttpResponse.json(
        headSha === HEAD
          ? { total_count: RUNS.length, workflow_runs: RUNS }
          : { total_count: 0, workflow_runs: [] }
      )
    }
  ),
  http.get(
    'https://api.github.com/repos/acme/app/actions/runs/:runId/jobs',
    ({ params, request }) => {
      const jobs = JOBS.get(String(params.runId)) ?? []

      return new URL(request.url).searchParams.get('filter') === 'all'
        ? HttpResponse.json({ total_count: jobs.length, jobs })
        : HttpResponse.json({ message: 'Read every attempt' }, { status: 422 })
    }
  ),
  http.get(
    'https://api.github.com/repos/acme/app/pulls/:number',
    ({ params, request }) => {
      if (request.headers.get('accept') !== 'application/vnd.github.v3.diff') {
        return HttpResponse.json({ message: 'Not a diff' }, { status: 415 })
      }

      return params.number === '7'
        ? HttpResponse.text(PULL_REQUEST_DIFF)
        : HttpResponse.json({ message: 'Not Found' }, { status: 404 })
    }
  )
)

const pullRequests = () => {
  return githubPullRequests(testOctokit(GITHUB_TOKEN))
}

describe('the pull request of a worker', () => {
  beforeAll(() => {
    network.listen({ onUnhandledFrame: 'error' })
  })

  afterAll(() => {
    network.close()
  })

  it('reads an open pull request with its checks, its files and the checks its token cannot see', async () => {
    await expect(
      pullRequests().read('https://github.com/acme/app/pull/7')
    ).resolves.toStrictEqual({
      key: '#7',
      title: 'Fix the login',
      url: 'https://github.com/acme/app/pull/7',
      description: 'The button logs in now.',
      state: 'open',
      author: { name: 'octocat', avatarUrl: 'https://avatars/octocat' },
      assignees: [{ name: 'octocat', avatarUrl: 'https://avatars/octocat' }],
      labels: [{ name: 'bug', color: '#d73a4a' }],
      reviewers: [
        {
          name: 'hubot',
          avatarUrl: 'https://avatars/hubot',
          state: 'changes-requested'
        },
        {
          name: 'monalisa',
          avatarUrl: 'https://avatars/monalisa',
          state: 'requested'
        },
        { name: 'Frontend', avatarUrl: undefined, state: 'requested' }
      ],
      base: 'main',
      head: 'fix-login',
      headCommit: HEAD,
      commitCount: 3,
      commentCount: 2,
      updatedAt: '2026-11-27T15:00:00Z',
      isInMergeQueue: false,
      mergeStatus: 'blocked',
      additions: 12,
      deletions: 3,
      checks: [
        {
          name: 'deploy/preview',
          state: 'success',
          url: 'https://preview.example/7',
          description: 'Preview ready'
        },
        { name: 'Lint', state: 'success', url: jobUrl('lint', 1) },
        { name: 'Test', state: 'pending', url: jobUrl('test', 0) }
      ],
      hiddenChecks: 1,
      files: [
        {
          path: 'src/login.ts',
          status: 'modified',
          additions: 10,
          deletions: 3
        },
        {
          path: 'src/login.test.ts',
          status: 'added',
          additions: 2,
          deletions: 0
        }
      ],
      fileCount: 2,
      merge: undefined,
      closedAt: undefined
    })
  })

  it('counts every check run as hidden when its token cannot read the Actions jobs', async () => {
    fakeActions.isRefused = true
    onTestFinished(() => {
      fakeActions.isRefused = false
    })

    const pullRequest = await pullRequests().read(
      'https://github.com/acme/app/pull/7'
    )

    expect([
      pullRequest?.checks.map(({ name }) => {
        return name
      }),
      pullRequest?.hiddenChecks
    ]).toStrictEqual([['deploy/preview'], CHECK_RUN_COUNT])
  })

  it('reads a pull request that waits in the merge queue', async () => {
    const pullRequest = await pullRequests().read(
      'https://github.com/acme/app/pull/11'
    )

    expect([pullRequest?.state, pullRequest?.isInMergeQueue]).toStrictEqual([
      'open',
      true
    ])
  })

  it('reads a draft as a draft, with no merge status', async () => {
    const pullRequest = await pullRequests().read(
      'https://github.com/acme/app/pull/8'
    )

    expect([pullRequest?.state, pullRequest?.mergeStatus]).toStrictEqual([
      'draft',
      undefined
    ])
  })

  it('reads the merge of a merged pull request: when, by whom, and its commit', async () => {
    const pullRequest = await pullRequests().read(
      'https://github.com/acme/app/pull/9'
    )

    expect([
      pullRequest?.state,
      pullRequest?.mergeStatus,
      pullRequest?.merge
    ]).toStrictEqual([
      'merged',
      undefined,
      {
        mergedAt: '2026-11-27T15:59:42Z',
        mergedBy: { name: 'hubot', avatarUrl: 'https://avatars/hubot' },
        commit: MERGE_COMMIT
      }
    ])
  })

  it('reads a closed pull request with when it closed, and no merge', async () => {
    const pullRequest = await pullRequests().read(
      'https://github.com/acme/app/pull/10'
    )

    expect([
      pullRequest?.state,
      pullRequest?.closedAt,
      pullRequest?.merge,
      pullRequest?.checks,
      pullRequest?.hiddenChecks
    ]).toStrictEqual(['closed', '2026-11-26T10:00:00Z', undefined, [], 0])
  })

  it('answers no pull request for a number GitHub does not know, or a link to another host', async () => {
    const source = pullRequests()

    await expect(
      source.read('https://github.com/acme/app/pull/404')
    ).resolves.toBeNull()
    await expect(
      source.read('https://gitlab.com/acme/app/-/merge_requests/7')
    ).resolves.toBeNull()
  })

  it('reads the diff of a pull request, and no diff for one GitHub does not know', async () => {
    const source = pullRequests()

    await expect(
      source.diff('https://github.com/acme/app/pull/7')
    ).resolves.toBe(PULL_REQUEST_DIFF)
    await expect(
      source.diff('https://github.com/acme/app/pull/404')
    ).resolves.toBeNull()
  })
})
