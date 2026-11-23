import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createHarnessHost } from '@tanstack/ai-harness'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { fakeText, type FakeResponseStep } from '@tanstack/ai/testing'
import {
  createHostFreeSandbox,
  defineTestWorker,
  runWorkerToolCall,
  SILENT_HOST_LOGGER,
  TEST_STARTER,
  type ToolCall
} from '@workcell/core/testing'
import { testOctokit } from '#/api/__tests__/test-octokit.ts'
import { createGithubReader } from '#/api/github-reader.ts'
import { GITHUB_TOOL_NAMES, githubTools } from '#/plugins/github-tools.ts'

const GITHUB_TOKEN = 'github_pat_reader_test_token'

const GITHUB_API = 'https://api.github.com'

const PULL_REQUEST_FILES_URL = `${GITHUB_API}/repos/acme/app/pulls/42/files`

const REPOSITORIES = ['acme/app', 'acme/api']

const REPOSITORY = 'acme/app'

const CHANGED_PATH = 'apps/web/src/login.tsx'

const LONG_PATCH_CHARS = 30_000

const LONG_PATCH = `@@ -1 +1 @@\n${'+'.repeat(LONG_PATCH_CHARS)}`

const LONG_FILE_LINE = 'const quote = "\\"";\n'

const LONG_FILE_LINES = 3_000

const MAX_PAGE_LINES = 1_900

const LONG_FILE = LONG_FILE_LINE.repeat(LONG_FILE_LINES)

const LONG_FILE_READ = {
  repository: 'acme/api',
  path: 'apps/web/src/quotes.ts',
  ref: 'main'
}

const RESTART_FILE_CONTENT = 'export const restartedRead = true\n'

const RESTART_FILE_READ = {
  repository: 'acme/api',
  path: 'apps/web/src/restart.ts',
  ref: 'main'
}

const graphqlBodySchema = z.object({
  query: z.string(),
  variables: z.record(z.string(), z.unknown())
})

type GithubRequest = { method: string; url: URL; accept: string }

type GraphqlBody = z.infer<typeof graphqlBodySchema>

let githubRequests: GithubRequest[]

let graphqlBodies: GraphqlBody[]

let restartFileReads: number

let restartReadStarted: PromiseWithResolvers<null>

let restartReadAnswer: Promise<null>

function changedFile(index: number) {
  return {
    filename: `apps/web/src/file-${index}.ts`,
    status: 'modified',
    additions: 1,
    deletions: 0,
    patch: '@@ -1 +1 @@\n+one'
  }
}

const PULL_REQUEST_FILES = [
  Array.from({ length: 100 }, (_, index) => {
    return changedFile(index)
  }),
  [
    {
      filename: CHANGED_PATH,
      status: 'modified',
      additions: LONG_PATCH_CHARS,
      deletions: 1,
      patch: LONG_PATCH
    }
  ]
]

const PULL_REQUEST = {
  number: 42,
  title: 'feat(web): sign in with a magic link',
  body: 'The login page sends a magic link.',
  state: 'closed',
  draft: false,
  merged: true,
  html_url: 'https://github.com/acme/app/pull/42',
  user: { login: 'colleague' },
  base: { ref: 'dev' },
  head: { ref: 'task-1-magic-link' },
  additions: 30_100,
  deletions: 1,
  changed_files: 101
}

const FILE_HISTORY = {
  data: {
    repository: {
      object: {
        history: {
          nodes: [
            {
              oid: 'a1b2c3d4e5',
              committedDate: '2026-11-05T09:48:25Z',
              messageHeadline:
                'fix(web): keep the session after a reload (#41)',
              messageBody: 'The cookie lost its path.',
              author: { name: 'Colleague', user: { login: 'colleague' } },
              associatedPullRequests: {
                nodes: [
                  {
                    number: 41,
                    title: 'fix(web): keep the session after a reload',
                    url: 'https://github.com/acme/app/pull/41'
                  }
                ]
              }
            }
          ]
        }
      }
    }
  }
}

function isAuthorized(request: Request) {
  return request.headers.get('authorization') === `token ${GITHUB_TOKEN}`
}

const network = setupServer(
  http.get(
    `${GITHUB_API}/repos/acme/app/pulls/:number`,
    ({ request, params }) => {
      if (!isAuthorized(request)) {
        return new HttpResponse(null, { status: 401 })
      }

      return params.number === '42'
        ? HttpResponse.json(PULL_REQUEST)
        : HttpResponse.json({ message: 'Not Found' }, { status: 404 })
    }
  ),
  http.get(PULL_REQUEST_FILES_URL, ({ request }) => {
    const page = Number(new URL(request.url).searchParams.get('page') ?? 1)
    const isLastPage = page === PULL_REQUEST_FILES.length

    return HttpResponse.json(PULL_REQUEST_FILES[page - 1] ?? [], {
      headers: isLastPage
        ? {}
        : {
            link: `<${PULL_REQUEST_FILES_URL}?per_page=100&page=${page + 1}>; rel="next"`
          }
    })
  }),
  http.get(`${GITHUB_API}/repos/acme/api/contents/*`, async ({ request }) => {
    const url = new URL(request.url)
    const pathname = decodeURIComponent(url.pathname)
    const ref = url.searchParams.get('ref')

    if (pathname.endsWith('/apps/web/src/restart.ts') && ref === 'main') {
      restartFileReads += 1
      restartReadStarted.resolve(null)
      await restartReadAnswer

      return HttpResponse.text(RESTART_FILE_CONTENT)
    }

    if (pathname.endsWith('/apps/web/src/quotes.ts') && ref === 'main') {
      return HttpResponse.text(LONG_FILE)
    }

    return pathname.endsWith('/apps/web/package.json') &&
      ref === 'feature/login'
      ? HttpResponse.text('{ "name": "web-on-feature" }')
      : HttpResponse.json({ message: 'Not Found' }, { status: 404 })
  }),
  http.post(`${GITHUB_API}/graphql`, async ({ request }) => {
    graphqlBodies.push(graphqlBodySchema.parse(await request.json()))

    return HttpResponse.json(FILE_HISTORY)
  })
)

function readerPlugins() {
  return [
    githubTools({
      reader: createGithubReader(testOctokit(GITHUB_TOKEN)),
      repositories: REPOSITORIES
    })
  ]
}

async function runGithubTool(toolCall: ToolCall, plugins = readerPlugins()) {
  return runWorkerToolCall({ hostFree, toolCall, mode: 'plan', plugins })
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
    plugins: readerPlugins()
  })

  return { host, model, worker }
}

let hostFree: Awaited<ReturnType<typeof createHostFreeSandbox>>

async function stopTheHostDuringTheRead(
  persistence: ReturnType<typeof memoryPersistence>,
  { threadId, inputId }: { threadId: string; inputId: string }
) {
  const answer = Promise.withResolvers<null>()
  restartReadAnswer = answer.promise
  const stopped = openWorker(persistence, [
    { toolCalls: [{ name: 'github_read_file', input: RESTART_FILE_READ }] }
  ])
  const session = await stopped.host.open(stopped.worker, {
    threadId,
    user: TEST_STARTER
  })
  await session.setPluginSetting({ key: 'mode', value: 'plan' })
  const turn = session.send('Read the file.', { inputId })
  await restartReadStarted.promise
  const closing = stopped.host.close({ recoverable: true })
  answer.resolve(null)
  await closing
  await Promise.allSettled([turn])
}

describe('the GitHub read tools', () => {
  beforeAll(async () => {
    network.listen({ onUnhandledFrame: 'error' })
    network.events.on('request:start', ({ request }) => {
      githubRequests.push({
        method: request.method,
        url: new URL(request.url),
        accept: request.headers.get('accept') ?? ''
      })
    })
    hostFree = await createHostFreeSandbox()
  })

  beforeEach(() => {
    githubRequests = []
    graphqlBodies = []
    restartFileReads = 0
    restartReadStarted = Promise.withResolvers()
    restartReadAnswer = Promise.resolve(null)
  })

  afterAll(async () => {
    network.close()
    await hostFree.destroy()
  })

  it('reads a pull request and its files in plan mode, with no question', async () => {
    const run = await runGithubTool({
      name: 'github_read_pull_request',
      input: { repository: REPOSITORY, number: 42 }
    })

    expect(run.asked).toBe(false)
    expect(
      run.modelTools.filter((name) => {
        return name.startsWith('github_')
      })
    ).toStrictEqual([...GITHUB_TOOL_NAMES])
    expect(JSON.parse(run.result)).toMatchObject({
      title: 'feat(web): sign in with a magic link',
      state: 'merged',
      filesListed: '100 of 101'
    })
    expect(run.result).toContain('"path":"apps/web/src/file-0.ts"')
  })

  it('reads the diff of one file past the first page, cut at its cap', async () => {
    const run = await runGithubTool({
      name: 'github_read_pull_request_patch',
      input: { repository: REPOSITORY, number: 42, path: CHANGED_PATH }
    })

    expect(JSON.parse(run.result)).toMatchObject({
      path: CHANGED_PATH,
      patch: { truncated: true, totalChars: LONG_PATCH.length }
    })
    expect(
      githubRequests.map(({ url }) => {
        return url.searchParams.get('page')
      })
    ).toStrictEqual([null, '2'])
  })

  it('reads a file on a branch other than the default branch', async () => {
    const run = await runGithubTool({
      name: 'github_read_file',
      input: {
        repository: 'acme/api',
        path: 'apps/web/package.json',
        ref: 'feature/login'
      }
    })

    expect(run.result).toContain('web-on-feature')
    expect(
      githubRequests.map(({ accept }) => {
        return accept
      })
    ).toStrictEqual(['application/vnd.github.v3.raw'])
  })

  it('reads a long file a page at a time, and every line reaches the model', async () => {
    const firstPage = await runGithubTool({
      name: 'github_read_file',
      input: LONG_FILE_READ
    })
    const secondPage = await runGithubTool({
      name: 'github_read_file',
      input: { ...LONG_FILE_READ, offset: 1_901 }
    })

    expect(firstPage.result).toBe(
      `${LONG_FILE_LINE.repeat(MAX_PAGE_LINES).trimEnd()}\n\n[Showing lines 1-1900 of 3000. Read more with offset 1901.]`
    )
    expect(secondPage.result).toBe(
      LONG_FILE_LINE.repeat(LONG_FILE_LINES - MAX_PAGE_LINES).trimEnd()
    )
  })

  it('reads the lines that the model asks for', async () => {
    const run = await runGithubTool({
      name: 'github_read_file',
      input: { ...LONG_FILE_READ, offset: 2_999, limit: 5 }
    })

    expect(run.result).toBe(LONG_FILE_LINE.repeat(2).trimEnd())
  })

  it('reads the file again after a host restart during the read, and the turn goes on', async () => {
    const persistence = memoryPersistence()
    const restart = { threadId: 'worker-read-restart', inputId: 'read-again' }
    await stopTheHostDuringTheRead(persistence, restart)

    const modelMessages: string[] = []
    const restarted = openWorker(persistence, [
      ({ request }) => {
        modelMessages.push(JSON.stringify(request.messages))

        return { text: 'Read the file.' }
      }
    ])
    await using reopened = await restarted.host.open(restarted.worker, {
      threadId: restart.threadId,
      user: TEST_STARTER
    })
    const settlement = await reopened.settled({ inputId: restart.inputId })
    await restarted.host.close()

    expect(settlement).toMatchObject({ outcome: 'completed' })
    expect(restartFileReads).toBe(2)
    expect(modelMessages.join('\n')).toContain('restartedRead')
    expect(modelMessages.join('\n')).not.toContain(
      'The tool may or may not have run.'
    )
    expect(restarted.model.state.callCount).toBe(1)
  })

  it('answers who last changed a file with the commits and their pull requests', async () => {
    const run = await runGithubTool({
      name: 'github_read_file_history',
      input: { repository: REPOSITORY, path: CHANGED_PATH }
    })

    expect(JSON.parse(run.result)).toStrictEqual([
      {
        sha: 'a1b2c3d4e5',
        date: '2026-11-05T09:48:25Z',
        author: 'colleague',
        headline: 'fix(web): keep the session after a reload (#41)',
        body: { text: 'The cookie lost its path.', truncated: false },
        pullRequest: {
          number: 41,
          title: 'fix(web): keep the session after a reload',
          url: 'https://github.com/acme/app/pull/41'
        }
      }
    ])
    expect(
      graphqlBodies.map(({ variables }) => {
        return variables
      })
    ).toStrictEqual([
      {
        owner: 'acme',
        name: 'app',
        expression: 'HEAD',
        path: CHANGED_PATH,
        first: 10
      }
    ])
  })

  it('sends only reads to GitHub', async () => {
    await runGithubTool({
      name: 'github_read_pull_request',
      input: { repository: REPOSITORY, number: 42 }
    })
    await runGithubTool({
      name: 'github_read_file',
      input: {
        repository: 'acme/api',
        path: 'apps/web/package.json',
        ref: 'feature/login'
      }
    })
    await runGithubTool({
      name: 'github_read_file_history',
      input: { repository: REPOSITORY, path: CHANGED_PATH }
    })

    expect(
      githubRequests.map(({ method, url }) => {
        return `${method} ${url.origin}${url.pathname}`
      })
    ).toStrictEqual([
      `GET ${GITHUB_API}/repos/acme/app/pulls/42`,
      `GET ${PULL_REQUEST_FILES_URL}`,
      `GET ${GITHUB_API}/repos/acme/api/contents/apps%2Fweb%2Fpackage.json`,
      `POST ${GITHUB_API}/graphql`
    ])
    expect(
      graphqlBodies.map(({ query }) => {
        return query.split('(')[0]
      })
    ).toStrictEqual(['query FileHistory'])
  })

  it('refuses a repository outside its list, with no GitHub call', async () => {
    const run = await runGithubTool({
      name: 'github_read_pull_request',
      input: { repository: 'acme/web', number: 42 }
    })

    expect(run.result).toContain('acme/app')
    expect(githubRequests).toStrictEqual([])
  })

  it('says when a pull request does not exist', async () => {
    const run = await runGithubTool({
      name: 'github_read_pull_request',
      input: { repository: REPOSITORY, number: 7 }
    })

    expect(run.result).toContain('GitHub has no pull request #7 in acme/app.')
    expect(githubRequests).toHaveLength(1)
  })

  it('refuses a path that climbs out of the repository, with no GitHub call', async () => {
    const run = await runGithubTool({
      name: 'github_read_file',
      input: {
        repository: 'acme/api',
        path: '../../acme/web/contents/README.md',
        ref: 'main'
      }
    })

    expect(run.result).toContain(
      'is not a file path of acme/api: each part of the path names a folder or the file.'
    )
    expect(githubRequests).toStrictEqual([])
  })
})
