import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { GITHUB_REST_URL } from './github-api.ts'
import { createGithubReader } from './github-reader.ts'

const GITHUB_TOKEN = 'github_pat_open'

const OPEN_PULL_REQUEST = 'https://github.com/acme/app/pull/12'

let requests: number

let rateLimited: boolean

const network = setupServer(
  http.get(`${GITHUB_REST_URL}/repos/acme/app/pulls`, ({ request }) => {
    const { searchParams } = new URL(request.url)
    requests += 1

    if (request.headers.get('authorization') !== `Bearer ${GITHUB_TOKEN}`) {
      return HttpResponse.json({ message: 'Bad credentials' }, { status: 401 })
    }

    if (rateLimited) {
      return new HttpResponse(null, {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'retry-after': '600' }
      })
    }

    const isOpenBranch =
      searchParams.get('state') === 'open' &&
      searchParams.get('head') === 'acme:task-12-fix-the-login'

    return HttpResponse.json(
      isOpenBranch ? [{ html_url: OPEN_PULL_REQUEST }] : []
    )
  })
)

describe('the open pull request of a branch', () => {
  beforeAll(() => {
    network.listen({ onUnhandledFrame: 'error' })
  })

  beforeEach(() => {
    requests = 0
    rateLimited = false
  })

  afterAll(() => {
    network.close()
  })

  it('finds the open pull request of a branch', async () => {
    using reader = createGithubReader(GITHUB_TOKEN)

    await expect(
      reader.openPullRequestUrl({
        repository: 'acme/app',
        branch: 'task-12-fix-the-login'
      })
    ).resolves.toBe(OPEN_PULL_REQUEST)
  })

  it('finds nothing for a branch with no open pull request', async () => {
    using reader = createGithubReader(GITHUB_TOKEN)

    await expect(
      reader.openPullRequestUrl({
        repository: 'acme/app',
        branch: 'task-13-merged'
      })
    ).resolves.toBeUndefined()
  })

  it('fails on a refused token, so the worker stays live', async () => {
    using reader = createGithubReader('github_pat_revoked')

    await expect(
      reader.openPullRequestUrl({
        repository: 'acme/app',
        branch: 'task-12-fix-the-login'
      })
    ).rejects.toThrow('GitHub answered 401')
  })

  it('stops the GitHub reads until the rate limit ends, and calls GitHub no more', async () => {
    rateLimited = true
    using reader = createGithubReader(GITHUB_TOKEN)
    const head = { repository: 'acme/app', branch: 'task-12-fix-the-login' }

    await expect(reader.openPullRequestUrl(head)).rejects.toThrow(
      'GitHub rate limits the GitHub reads until'
    )
    await expect(
      reader.readPullRequest({ repository: 'acme/app', number: 12 })
    ).rejects.toThrow('GitHub rate limits the GitHub reads until')

    expect(requests).toBe(1)
  })
})
