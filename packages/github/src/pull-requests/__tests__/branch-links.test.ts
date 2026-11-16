import { describe, expect, it } from 'vitest'
import { branchPullRequestsUrl } from '#/pull-requests/branch-links.ts'

describe('branchPullRequestsUrl', () => {
  it('searches the pull requests of a branch on GitHub', () => {
    expect(
      branchPullRequestsUrl({ repository: 'acme/app', branch: 'task-7/fix' })
    ).toBe('https://github.com/acme/app/pulls?q=is%3Apr%20head%3Atask-7%2Ffix')
  })
})
