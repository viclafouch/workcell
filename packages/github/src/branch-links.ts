const GITHUB_WEB_URL = 'https://github.com'

type BranchPullRequestsUrlParams = { repository: string; branch: string }

export function branchPullRequestsUrl({
  repository,
  branch
}: BranchPullRequestsUrlParams) {
  return `${GITHUB_WEB_URL}/${repository}/pulls?q=${encodeURIComponent(`is:pr head:${branch}`)}`
}
