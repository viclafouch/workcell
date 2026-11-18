import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testOctokit } from '#/api/__tests__/test-octokit.ts'
import { createGithubReader } from '#/api/github-reader.ts'

const GITHUB_TOKEN = 'github_pat_open'

const OPEN_PULL_REQUEST = 'https://github.com/acme/app/pull/12'

const network = setupServer(
  http.get('https://api.github.com/repos/acme/app/pulls', ({ request }) => {
    const { searchParams } = new URL(request.url)

    if (request.headers.get('authorization') !== `token ${GITHUB_TOKEN}`) {
      return HttpResponse.json({ message: 'Bad credentials' }, { status: 401 })
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

  afterAll(() => {
    network.close()
  })

  it('finds the open pull request of a branch', async () => {
    const reader = createGithubReader(testOctokit(GITHUB_TOKEN))

    await expect(
      reader.openPullRequestUrl({
        repository: 'acme/app',
        branch: 'task-12-fix-the-login'
      })
    ).resolves.toBe(OPEN_PULL_REQUEST)
  })

  it('finds nothing for a branch with no open pull request', async () => {
    const reader = createGithubReader(testOctokit(GITHUB_TOKEN))

    await expect(
      reader.openPullRequestUrl({
        repository: 'acme/app',
        branch: 'task-13-merged'
      })
    ).resolves.toBeUndefined()
  })

  it('fails on a refused token, so the worker stays live', async () => {
    const reader = createGithubReader(testOctokit('github_pat_revoked'))

    await expect(
      reader.openPullRequestUrl({
        repository: 'acme/app',
        branch: 'task-12-fix-the-login'
      })
    ).rejects.toMatchObject({ status: 401 })
  })
})
