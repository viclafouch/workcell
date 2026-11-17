import { z } from 'zod'
import { workerMetadataSchema, type WorkerMetadata } from '@workcell/core'

const GITHUB_WEB_URL = 'https://github.com'

export const taskPullRequestSchema = workerMetadataSchema.extend({
  pullRequest: z.string().optional()
})

export function pullRequestUrlPrefix(repository: string) {
  return `${GITHUB_WEB_URL}/${repository}/pull/`
}

type BranchPullRequestsUrlParams = { repository: string; branch: string }

function branchPullRequestsUrl({
  repository,
  branch
}: BranchPullRequestsUrlParams) {
  return `${GITHUB_WEB_URL}/${repository}/pulls?q=${encodeURIComponent(`is:pr head:${branch}`)}`
}

export function pullRequestUrlOf(metadata: WorkerMetadata) {
  const { repository, branch, pullRequest } =
    taskPullRequestSchema.parse(metadata)

  if (pullRequest !== undefined) {
    return pullRequest
  }

  return branch === undefined
    ? undefined
    : branchPullRequestsUrl({ repository, branch })
}
