import { workerMetadataSchema, type WorkerMetadata } from '@workcell/core'

const GITHUB_WEB_URL = 'https://github.com'

type BranchPullRequestsUrlParams = { repository: string; branch: string }

function branchPullRequestsUrl({
  repository,
  branch
}: BranchPullRequestsUrlParams) {
  return `${GITHUB_WEB_URL}/${repository}/pulls?q=${encodeURIComponent(`is:pr head:${branch}`)}`
}

export function pullRequestUrlOf(metadata: WorkerMetadata) {
  const { repository, branch, pullRequest } =
    workerMetadataSchema.parse(metadata)

  if (pullRequest !== undefined) {
    return pullRequest
  }

  return branch === undefined
    ? undefined
    : branchPullRequestsUrl({ repository, branch })
}
