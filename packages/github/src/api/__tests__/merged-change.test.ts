import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testOctokit } from '#/api/__tests__/test-octokit.ts'
import { createGithubReader } from '#/api/github-reader.ts'

const GITHUB_TOKEN = 'github_pat_merged'

const MERGE_COMMIT = 'c0ffee0000000000000000000000000000000000'

const BASE_COMMIT = 'ba5e000000000000000000000000000000000000'

const MERGED_DIFF = 'diff --git a/greeting.txt b/greeting.txt\n-hello\n+hi\n'

const network = setupServer(
  http.get(
    'https://api.github.com/repos/acme/app/pulls/:number',
    ({ params }) => {
      return HttpResponse.json({
        number: Number(params.number),
        merged: params.number === '12',
        merge_commit_sha: params.number === '12' ? MERGE_COMMIT : null
      })
    }
  ),
  http.get(
    `https://api.github.com/repos/acme/app/commits/${MERGE_COMMIT}`,
    () => {
      return HttpResponse.json({
        sha: MERGE_COMMIT,
        parents: [{ sha: BASE_COMMIT }]
      })
    }
  ),
  http.get(
    `https://api.github.com/repos/acme/app/compare/${BASE_COMMIT}...${MERGE_COMMIT}`,
    ({ request }) => {
      return request.headers.get('accept') === 'application/vnd.github.v3.diff'
        ? HttpResponse.text(MERGED_DIFF)
        : HttpResponse.json({ message: 'Not a diff' }, { status: 415 })
    }
  )
)

describe('the merged change of a pull request', () => {
  beforeAll(() => {
    network.listen({ onUnhandledFrame: 'error' })
  })

  afterAll(() => {
    network.close()
  })

  it('reads the commit the merge landed on, and the diff it brought', async () => {
    const reader = createGithubReader(testOctokit(GITHUB_TOKEN))

    await expect(
      reader.readMergedChange('https://github.com/acme/app/pull/12')
    ).resolves.toStrictEqual({ baseCommit: BASE_COMMIT, diff: MERGED_DIFF })
  })

  it('finds no change in a pull request that never merged', async () => {
    const reader = createGithubReader(testOctokit(GITHUB_TOKEN))

    await expect(
      reader.readMergedChange('https://github.com/acme/app/pull/13')
    ).resolves.toBeUndefined()
  })

  it('refuses a link that names no GitHub pull request', async () => {
    const reader = createGithubReader(testOctokit(GITHUB_TOKEN))

    await expect(
      reader.readMergedChange('https://gitlab.com/acme/app/-/merge_requests/12')
    ).rejects.toThrow('names no GitHub pull request')
  })
})
