import { z } from 'zod'
import { createPacedFetch, type PacedRequest } from '@workcell/core'
import {
  GITHUB_JSON_MEDIA_TYPE,
  GITHUB_REST_URL,
  githubPacing,
  splitRepository,
  type PullRequestHeadRef
} from '#/api/github-api.ts'

const REQUESTS_PER_MINUTE = 20

const MISSING_BRANCH_STATUS = 422

const FIRST_ERROR_STATUS = 400

const pullRequestsSchema = z.array(
  z.object({
    number: z.number(),
    html_url: z.string(),
    state: z.enum(['open', 'closed'])
  })
)

export type BranchPullRequest = {
  number: number
  url: string
  isOpen: boolean
}

function refPath(branch: string) {
  return branch.split('/').map(encodeURIComponent).join('/')
}

export function createPullRequestCloser(token: string) {
  const { pacedFetch, [Symbol.dispose]: dispose } = createPacedFetch({
    ...githubPacing(token),
    subject: 'the ticket reset',
    requestsPerMinute: REQUESTS_PER_MINUTE
  })

  const call = async (
    path: string,
    init: PacedRequest = {},
    acceptedStatuses: readonly number[] = []
  ) => {
    const answer = await pacedFetch(`${GITHUB_REST_URL}${path}`, {
      ...init,
      headers: { accept: GITHUB_JSON_MEDIA_TYPE }
    })

    if (
      answer.status >= FIRST_ERROR_STATUS &&
      !acceptedStatuses.includes(answer.status)
    ) {
      throw new Error(
        `GitHub answered ${answer.status} to ${init.method ?? 'GET'} ${path}.`
      )
    }

    return answer
  }

  const pullRequestsOf = async ({
    repository,
    branch
  }: PullRequestHeadRef): Promise<BranchPullRequest[]> => {
    const { owner, name } = splitRepository(repository)
    const query = new URLSearchParams({
      head: `${owner}:${branch}`,
      state: 'all'
    })
    const { text } = await call(
      `/repos/${owner}/${name}/pulls?${query.toString()}`
    )

    return pullRequestsSchema
      .parse(JSON.parse(text))
      .map(({ number, html_url, state }) => {
        return { number, url: html_url, isOpen: state === 'open' }
      })
  }

  const closePullRequest = async (repository: string, number: number) => {
    const { owner, name } = splitRepository(repository)
    await call(`/repos/${owner}/${name}/pulls/${number}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed' })
    })
  }

  const deleteBranch = async ({ repository, branch }: PullRequestHeadRef) => {
    const { owner, name } = splitRepository(repository)
    await call(
      `/repos/${owner}/${name}/git/refs/heads/${refPath(branch)}`,
      { method: 'DELETE' },
      [MISSING_BRANCH_STATUS]
    )
  }

  return {
    pullRequestsOf,
    closePullRequest,
    deleteBranch,
    [Symbol.dispose]: dispose
  }
}

export type PullRequestCloser = ReturnType<typeof createPullRequestCloser>
