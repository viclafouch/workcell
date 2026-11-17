import { describe, expect, it } from 'vitest'
import { pullRequestUrlOf } from '#/pull-requests/pull-request-url.ts'

const WORKER = {
  name: 'Alpha',
  task: 'Do the task TASK-7.',
  repository: 'acme/app'
}

describe('pullRequestUrlOf', () => {
  it('has no link before the worker has a branch', () => {
    expect(pullRequestUrlOf(WORKER)).toBeUndefined()
  })

  it('searches the pull requests of the branch before the pull request opens', () => {
    expect(pullRequestUrlOf({ ...WORKER, branch: 'task-7/fix' })).toBe(
      'https://github.com/acme/app/pulls?q=is%3Apr%20head%3Atask-7%2Ffix'
    )
  })

  it('opens the pull request once the worker has one', () => {
    expect(
      pullRequestUrlOf({
        ...WORKER,
        branch: 'task-7/fix',
        pullRequest: 'https://github.com/acme/app/pull/42'
      })
    ).toBe('https://github.com/acme/app/pull/42')
  })
})
