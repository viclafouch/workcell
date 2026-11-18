import type { PullRequestHeadRef } from '#/api/github-api.ts'
import {
  splitRepository,
  undefinedOnStatus,
  type GithubOctokit
} from '#/api/github-octokit.ts'

const MISSING_BRANCH_STATUS = 422

export type BranchPullRequest = {
  number: number
  url: string
  isOpen: boolean
}

export function createPullRequestCloser(octokit: GithubOctokit) {
  const pullRequestsOf = async ({
    repository,
    branch
  }: PullRequestHeadRef): Promise<BranchPullRequest[]> => {
    const { owner, repo } = splitRepository(repository)
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
      owner,
      repo,
      head: `${owner}:${branch}`,
      state: 'all'
    })

    return data.map(({ number, html_url, state }) => {
      return { number, url: html_url, isOpen: state === 'open' }
    })
  }

  const closePullRequest = async (repository: string, number: number) => {
    await octokit.request('PATCH /repos/{owner}/{repo}/pulls/{pull_number}', {
      ...splitRepository(repository),
      pull_number: number,
      state: 'closed'
    })
  }

  const deleteBranch = async ({ repository, branch }: PullRequestHeadRef) => {
    await undefinedOnStatus(
      MISSING_BRANCH_STATUS,
      octokit.request('DELETE /repos/{owner}/{repo}/git/refs/{ref}', {
        ...splitRepository(repository),
        ref: `heads/${branch}`
      })
    )
  }

  return { pullRequestsOf, closePullRequest, deleteBranch }
}

export type PullRequestCloser = ReturnType<typeof createPullRequestCloser>
