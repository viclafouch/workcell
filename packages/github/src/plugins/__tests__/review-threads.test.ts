import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createHarnessHost } from '@tanstack/ai-harness'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { fakeText, type FakeResponseStep } from '@tanstack/ai/testing'
import type { WorkerMetadata } from '@workcell/core'
import {
  createHostFreeSandbox,
  decideWorkerToolCall,
  defineTestWorker,
  runWorkerToolCall,
  SILENT_HOST_LOGGER,
  TEST_STARTER,
  type ToolCall
} from '@workcell/core/testing'
import { testOctokit } from '#/api/__tests__/test-octokit.ts'
import { createGithubReader } from '#/api/github-reader.ts'
import { createReviewThreadWriter } from '#/api/review-thread-writer.ts'
import { reviewThreadTools } from '#/plugins/review-threads.ts'
import {
  REPLY_TOOL_NAME,
  RESOLVE_TOOL_NAME,
  REVIEW_THREADS_TOOL_NAME
} from '#/prompts/github.ts'
import { pullRequestEvents } from '#/pull-requests/pull-request-events.ts'

const GITHUB_TOKEN = 'github_pat_review_threads_test_token'

const GITHUB_API = 'https://api.github.com'

const GITHUB_GRAPHQL_URL = `${GITHUB_API}/graphql`

const REPOSITORY = 'acme/app'

const BRANCH = 'task-7-retry-only-network-failures'

const PULL_REQUEST_NUMBER = 16_500

const PULL_REQUEST_URL = `https://github.com/acme/app/pull/${PULL_REQUEST_NUMBER}`

const FINDING_URL = `${PULL_REQUEST_URL}#discussion_r101`

const PULL_REQUEST_ID = 'PR_kwDOworker'

const BOT_THREAD_ID = 'PRRT_kwDObotfinding'

const BOT_COMMENT_ID = '3474659425'

const OTHER_THREAD_ID = 'PRRT_kwDOotherpullrequest'

const REPLY_URL = `${PULL_REQUEST_URL}#discussion_r3474659999`

const FIX_REPLY = 'Fixed in 4f2a9c1: the retry keeps every 5xx.'

const FINDING_BODY =
  'Bug: the retry now skips a 503, so a short outage of the API fails at once.'

const WORKER_METADATA: WorkerMetadata = {
  name: 'Alpha',
  task: 'Take TASK-7 to a pull request.',
  repository: REPOSITORY,
  branch: BRANCH
}

const graphqlBodySchema = z.object({
  query: z.string(),
  variables: z.record(z.string(), z.unknown())
})

type GraphqlBody = z.infer<typeof graphqlBodySchema>

let githubRequests: string[]

let graphqlBodies: GraphqlBody[]

let hasOpenPullRequest: boolean

let replies: { path: string; body: unknown }[]

let replyOnGithub: PromiseWithResolvers<null>

let replyAnswer: Promise<null>

const SECOND_PAGE_CURSOR = 'threads-page-2'

const RESOLVED_THREAD = {
  id: 'PRRT_kwDOresolved',
  isResolved: true,
  isOutdated: false,
  path: 'apps/web/src/main.tsx',
  line: 3,
  originalLine: 3,
  comments: {
    totalCount: 1,
    nodes: [
      {
        author: { login: 'colleague' },
        body: 'Rename this import.',
        url: `${PULL_REQUEST_URL}#discussion_r100`
      }
    ]
  }
}

const BOT_FINDING_THREAD = {
  id: BOT_THREAD_ID,
  isResolved: false,
  isOutdated: false,
  path: 'apps/web/src/query-client.ts',
  line: 12,
  originalLine: 12,
  comments: {
    totalCount: 2,
    nodes: [
      {
        author: { login: 'review-bot' },
        body: FINDING_BODY,
        url: FINDING_URL
      },
      {
        author: { login: 'colleague' },
        body: 'Agreed, keep the 5xx in the retry.',
        url: `${PULL_REQUEST_URL}#discussion_r102`
      }
    ]
  }
}

function reviewThreadsPage(cursor: unknown) {
  const isFirstPage = cursor === null

  return {
    reviewThreads: {
      totalCount: 2,
      pageInfo: {
        hasNextPage: isFirstPage,
        endCursor: isFirstPage ? SECOND_PAGE_CURSOR : null
      },
      nodes: isFirstPage ? [RESOLVED_THREAD] : [BOT_FINDING_THREAD]
    }
  }
}

const THREAD_NODES = new Map([
  [
    BOT_THREAD_ID,
    {
      isResolved: false,
      pullRequest: { id: PULL_REQUEST_ID },
      comments: { nodes: [{ fullDatabaseId: BOT_COMMENT_ID }] }
    }
  ],
  [
    OTHER_THREAD_ID,
    {
      isResolved: false,
      pullRequest: { id: 'PR_kwDOother' },
      comments: { nodes: [{ fullDatabaseId: '3474650001' }] }
    }
  ]
])

function operationOf({ query }: GraphqlBody) {
  return query.split('(')[0]
}

function mutations() {
  return graphqlBodies.filter(({ query }) => {
    return query.startsWith('mutation ')
  })
}

function graphqlData(body: GraphqlBody) {
  const operation = operationOf(body)
  const { variables } = body

  if (operation === 'query ReviewThreadTarget') {
    return {
      repository: {
        pullRequests: {
          nodes: hasOpenPullRequest
            ? [{ id: PULL_REQUEST_ID, number: PULL_REQUEST_NUMBER }]
            : []
        }
      },
      node: THREAD_NODES.get(String(variables.threadId)) ?? null
    }
  }

  if (operation === 'mutation ResolveReviewThread') {
    return { resolveReviewThread: { thread: { isResolved: true } } }
  }

  return {
    repository: { pullRequest: reviewThreadsPage(variables.cursor ?? null) }
  }
}

function isHostToken(request: Request) {
  return request.headers.get('authorization') === `token ${GITHUB_TOKEN}`
}

const network = setupServer(
  http.post(GITHUB_GRAPHQL_URL, async ({ request }) => {
    if (!isHostToken(request)) {
      return new HttpResponse(null, { status: 401 })
    }

    const body = graphqlBodySchema.parse(await request.json())
    graphqlBodies.push(body)

    return HttpResponse.json({ data: graphqlData(body) })
  }),
  http.get(`${GITHUB_API}/repos/acme/app/pulls`, ({ request }) => {
    const { searchParams } = new URL(request.url)
    const isOpenBranch =
      hasOpenPullRequest &&
      searchParams.get('state') === 'open' &&
      searchParams.get('head') === `acme:${BRANCH}`

    return isHostToken(request)
      ? HttpResponse.json(
          isOpenBranch
            ? [{ number: PULL_REQUEST_NUMBER, html_url: PULL_REQUEST_URL }]
            : []
        )
      : new HttpResponse(null, { status: 401 })
  }),
  http.post(
    `${GITHUB_API}/repos/:owner/:name/pulls/:number/comments/:commentId/replies`,
    async ({ request }) => {
      if (!isHostToken(request)) {
        return new HttpResponse(null, { status: 401 })
      }

      replies.push({
        path: new URL(request.url).pathname,
        body: await request.json()
      })
      replyOnGithub.resolve(null)
      await replyAnswer

      return HttpResponse.json(
        { id: 3_474_659_999, html_url: REPLY_URL },
        { status: 201 }
      )
    }
  )
)

let hostFree: Awaited<ReturnType<typeof createHostFreeSandbox>>

function callTool(
  toolCall: ToolCall,
  { metadata = WORKER_METADATA }: { metadata?: WorkerMetadata } = {}
) {
  return runWorkerToolCall({
    hostFree,
    toolCall,
    mode: 'bypass',
    metadata,
    plugins: reviewThreadPlugins()
  })
}

function reviewThreadPlugins() {
  return [
    reviewThreadTools({
      reader: createGithubReader(testOctokit(GITHUB_TOKEN)),
      writer: createReviewThreadWriter(testOctokit(GITHUB_TOKEN))
    })
  ]
}

function openWorker(
  persistence: ReturnType<typeof memoryPersistence>,
  responses: FakeResponseStep[]
) {
  const model = fakeText()
  model.setResponses(responses)
  const host = createHarnessHost({ persistence, logger: SILENT_HOST_LOGGER })
  const worker = defineTestWorker({
    host,
    model,
    hostFree,
    plugins: reviewThreadPlugins()
  })

  return { host, model, worker }
}

async function readReviewThreads(metadata = WORKER_METADATA) {
  return callTool({ name: REVIEW_THREADS_TOOL_NAME, input: {} }, { metadata })
}

describe('the review threads tool of a worker', () => {
  beforeAll(async () => {
    network.listen({ onUnhandledFrame: 'error' })
    network.events.on('request:start', ({ request }) => {
      githubRequests.push(`${request.method} ${request.url}`)
    })
    hostFree = await createHostFreeSandbox()
  })

  beforeEach(() => {
    githubRequests = []
    graphqlBodies = []
    hasOpenPullRequest = true
    replies = []
    replyOnGithub = Promise.withResolvers()
    replyAnswer = Promise.resolve(null)
  })

  afterAll(async () => {
    network.close()
    await hostFree.destroy()
  })

  it('reads an inline bot finding that woke the worker, with its file, line, author, body and replies, and leaves the resolved threads out', async () => {
    const wake = pullRequestEvents({
      repository: REPOSITORY,
      viewerLogin: 'host-developer',
      pullRequest: {
        number: 16_500,
        url: PULL_REQUEST_URL,
        merged: false,
        closed: false,
        mergeable: 'MERGEABLE',
        headRefOid: 'head-1',
        mergeCommit: null,
        statusCheckRollup: {
          state: 'SUCCESS',
          contexts: { checkRunCountsByState: [] }
        },
        commits: { nodes: [] },
        reviewThreads: {
          nodes: [
            {
              isResolved: false,
              comments: {
                nodes: [
                  {
                    id: 'finding-1',
                    url: FINDING_URL,
                    createdAt: '2026-11-20T09:00:00Z',
                    author: { __typename: 'Bot', login: 'review-bot' }
                  }
                ]
              }
            }
          ]
        },
        comments: { nodes: [] },
        reviews: { nodes: [] },
        timelineItems: { nodes: [] }
      }
    }).find(({ kind }) => {
      return kind === 'review-comment'
    })

    expect(wake?.action).toStrictEqual({
      type: 'wake',
      delivery: 'steer',
      message: `review-bot commented on a review thread of the pull request ${PULL_REQUEST_URL}: ${FINDING_URL}. Read the thread with ${REVIEW_THREADS_TOOL_NAME}. Push a fix, or keep the code with a reason. Reply on the thread with ${REPLY_TOOL_NAME}, then resolve it with ${RESOLVE_TOOL_NAME}. Then end your turn.`
    })

    const run = await readReviewThreads()

    expect(run.asked).toBe(false)
    expect(run.modelTools).toContain(REVIEW_THREADS_TOOL_NAME)
    expect(JSON.parse(run.result)).toStrictEqual({
      pullRequest: PULL_REQUEST_URL,
      threadsRead: '2 of 2',
      resolvedThreads: 1,
      unresolvedThreads: [
        {
          threadId: BOT_THREAD_ID,
          path: 'apps/web/src/query-client.ts',
          line: 12,
          outdated: false,
          author: 'review-bot',
          body: { text: FINDING_BODY, truncated: false },
          url: FINDING_URL,
          replies: [
            {
              author: 'colleague',
              body: {
                text: 'Agreed, keep the 5xx in the retry.',
                truncated: false
              },
              url: `${PULL_REQUEST_URL}#discussion_r102`
            }
          ],
          repliesListed: '1 of 1'
        }
      ]
    })
  })

  it('writes nothing on GitHub when it reads the threads', async () => {
    await readReviewThreads()

    expect(replies).toStrictEqual([])
    expect(mutations()).toStrictEqual([])
  })

  it('says when the branch of the worker has no open pull request', async () => {
    hasOpenPullRequest = false

    const run = await readReviewThreads()

    expect(run.result).toContain(
      `GitHub has no open pull request for the branch ${BRANCH} of ${REPOSITORY}.`
    )
  })

  it('says when the worker has no branch yet, with no GitHub call', async () => {
    const { branch: _branch, ...withoutBranch } = WORKER_METADATA

    const run = await readReviewThreads(withoutBranch)

    expect(run.result).toContain('This task has no branch yet')
    expect(githubRequests).toStrictEqual([])
  })

  it('replies on the inline bot finding of its own pull request, with the thread id that the read gives, and leaves the thread open', async () => {
    const run = await callTool({
      name: REPLY_TOOL_NAME,
      input: { threadId: BOT_THREAD_ID, body: FIX_REPLY }
    })

    expect(run.asked).toBe(false)
    expect(run.modelTools).toContain(REPLY_TOOL_NAME)
    expect(run.result).toContain(REPLY_URL)
    expect(replies).toStrictEqual([
      {
        path: `/repos/acme/app/pulls/${PULL_REQUEST_NUMBER}/comments/${BOT_COMMENT_ID}/replies`,
        body: { body: FIX_REPLY }
      }
    ])
    expect(mutations()).toStrictEqual([])
  })

  it('resolves the thread of its own pull request', async () => {
    const run = await callTool({
      name: RESOLVE_TOOL_NAME,
      input: { threadId: BOT_THREAD_ID }
    })

    expect(run.asked).toBe(false)
    expect(run.result).toContain(`Resolved the thread ${BOT_THREAD_ID}.`)
    expect(replies).toStrictEqual([])
    expect(
      mutations().map(({ variables }) => {
        return variables.threadId
      })
    ).toStrictEqual([BOT_THREAD_ID])
  })

  it('refuses to reply on or resolve a thread of another pull request, and writes nothing on GitHub', async () => {
    const reply = await callTool({
      name: REPLY_TOOL_NAME,
      input: { threadId: OTHER_THREAD_ID, body: FIX_REPLY }
    })
    const resolve = await callTool({
      name: RESOLVE_TOOL_NAME,
      input: { threadId: OTHER_THREAD_ID }
    })

    const refusal = `${OTHER_THREAD_ID} is not a review thread of your pull request #${PULL_REQUEST_NUMBER}.`

    expect(reply.result).toContain(refusal)
    expect(resolve.result).toContain(refusal)
    expect(replies).toStrictEqual([])
    expect(mutations()).toStrictEqual([])
  })

  it.each([REPLY_TOOL_NAME, RESOLVE_TOOL_NAME])(
    'blocks %s in plan mode',
    async (name) => {
      await expect(
        decideWorkerToolCall({
          hostFree,
          toolCall: { name, input: { threadId: BOT_THREAD_ID } },
          mode: 'plan',
          plugins: reviewThreadPlugins()
        })
      ).resolves.toMatchObject({ decision: 'deny' })
    }
  )

  it('posts the reply once when the host stops during the write, and tells the model to check the thread', async () => {
    const persistence = memoryPersistence()
    const answer = Promise.withResolvers<null>()
    replyAnswer = answer.promise
    const threadId = 'worker-reply-restart'
    const inputId = 'review-comment:finding-1'
    const stopped = openWorker(persistence, [
      {
        toolCalls: [
          {
            name: REPLY_TOOL_NAME,
            input: { threadId: BOT_THREAD_ID, body: FIX_REPLY }
          }
        ]
      }
    ])
    const session = await stopped.host.open(stopped.worker, {
      threadId,
      user: TEST_STARTER
    })
    await session.updateIndexEntry({ metadata: WORKER_METADATA })
    await session.setPluginSetting({ key: 'mode', value: 'bypass' })
    const turn = session.send('Reply on the finding.', { inputId })
    await replyOnGithub.promise
    const closing = stopped.host.close({ recoverable: true })
    answer.resolve(null)
    await closing
    await Promise.allSettled([turn])

    const modelMessages: string[] = []
    const restarted = openWorker(persistence, [
      ({ request }) => {
        modelMessages.push(JSON.stringify(request.messages))

        return { text: 'Checked the thread first.' }
      }
    ])
    await using reopened = await restarted.host.open(restarted.worker, {
      threadId,
      user: TEST_STARTER
    })
    await reopened.settled({ inputId })
    await restarted.host.close()

    expect(replies).toHaveLength(1)
    expect(modelMessages.join('\n')).toContain(
      'The tool may or may not have run. Check before you retry.'
    )
    expect(restarted.model.state.callCount).toBe(1)
  })
})
