import { describe, expect, it } from 'vitest'
import {
  REPOSITORY,
  WORKER,
  PULL_REQUEST_URL,
  githubFake,
  openPullRequest,
  checks,
  status,
  openWatcher,
  serveGithubPerTest,
  pollTwice
} from './pull-request-watcher-fixtures.ts'

const SQUASH_COMMAND = `gh pr merge ${PULL_REQUEST_URL} --squash --match-head-commit head-1`

function onTheBranch(changes: Parameters<typeof openPullRequest>[0] = {}) {
  return [
    {
      repository: REPOSITORY,
      branch: WORKER.branch,
      pullRequest: openPullRequest(changes)
    }
  ]
}

describe('the merge of a ready pull request', () => {
  serveGithubPerTest()

  it('records the exact merge command of a green, mergeable pull request and wakes the worker with it once', async () => {
    githubFake.pullRequests = onTheBranch()
    const { watcher, updates, wakes, posts } = openWatcher()

    await pollTwice(watcher)

    expect(updates).toContainEqual({
      threadId: WORKER.threadId,
      metadata: { mergeCommand: SQUASH_COMMAND }
    })
    expect(wakes).toStrictEqual([
      {
        threadId: WORKER.threadId,
        inputId: 'github:acme/app#42:ready:head-1',
        delivery: 'followUp',
        message: `The pull request watcher sends this, not a person. The pull request ${PULL_REQUEST_URL} is ready: its checks are green on head-1. Merge it with this exact command, and no other: ${SQUASH_COMMAND} When GitHub refuses it, change nothing: the host ends the task. Then end your turn.`
      }
    ])
    expect(posts).toStrictEqual([])
  })

  it('records a command with no merge method when the base branch requires a merge queue', async () => {
    githubFake.pullRequests = onTheBranch({ isMergeQueueEnabled: true })
    const { watcher, updates } = openWatcher()

    await pollTwice(watcher)

    expect(updates).toContainEqual({
      threadId: WORKER.threadId,
      metadata: {
        mergeCommand: `gh pr merge ${PULL_REQUEST_URL} --match-head-commit head-1`
      }
    })
  })

  it('posts once per head commit the people whose approval a green pull request waits for, and records no command', async () => {
    githubFake.pullRequests = onTheBranch({
      reviewDecision: 'REVIEW_REQUIRED',
      reviewRequests: {
        nodes: [
          { requestedReviewer: { __typename: 'User', login: 'code-owner' } },
          { requestedReviewer: { __typename: 'Team', slug: 'platform' } }
        ]
      }
    })
    const { watcher, updates, wakes, posts } = openWatcher()

    await pollTwice(watcher)

    expect(updates).toStrictEqual([
      { threadId: WORKER.threadId, metadata: { pullRequest: PULL_REQUEST_URL } }
    ])
    expect(wakes).toStrictEqual([])
    expect(posts).toStrictEqual([
      {
        threadId: WORKER.threadId,
        inputId: 'github:acme/app#42:approval-wait:head-1',
        line: `Checks green, waiting for the approval of @code-owner, @platform: ${PULL_REQUEST_URL}`
      }
    ])
  })

  it('clears the recorded command once the pull request is no longer ready, and only then', async () => {
    githubFake.pullRequests = onTheBranch({
      ...checks('FAILURE', status('code/scan', 'FAILURE')),
      headRefOid: 'head-2'
    })
    const recorded = openWatcher({
      liveWorkers: [
        {
          ...WORKER,
          pullRequest: PULL_REQUEST_URL,
          mergeCommand: SQUASH_COMMAND
        }
      ]
    })
    const never = openWatcher({
      liveWorkers: [{ ...WORKER, pullRequest: PULL_REQUEST_URL }]
    })

    await pollTwice(recorded.watcher)
    await pollTwice(never.watcher)

    expect(recorded.updates).toStrictEqual([
      { threadId: WORKER.threadId, metadata: { mergeCommand: undefined } }
    ])
    expect(never.updates).toStrictEqual([])
  })

  it('ends the task as blocked once GitHub refused its merge, with the refusal as its cause and a report that names its starter, once', async () => {
    githubFake.pullRequests = onTheBranch()
    const { watcher, wakes, finishes } = openWatcher({
      liveWorkers: [
        {
          ...WORKER,
          pullRequest: PULL_REQUEST_URL,
          starterId: 'starter-1',
          mergeCommand: SQUASH_COMMAND,
          mergeRefusal:
            'Pull request is not mergeable: a required review is missing.'
        }
      ]
    })

    await pollTwice(watcher)

    expect(wakes).toStrictEqual([])
    expect(finishes).toStrictEqual([
      {
        threadId: WORKER.threadId,
        report: `@starter-1 GitHub refused the merge of ${PULL_REQUEST_URL}: Pull request is not mergeable: a required review is missing.\nSubject: TASK-1`,
        outcome: {
          value: 'blocked',
          cause:
            'GitHub refused the merge: Pull request is not mergeable: a required review is missing.'
        }
      }
    ])
  })

  it('wakes the worker with one input id and one command across host restarts while the merge waits for the checks, and ends it once merged', async () => {
    githubFake.pullRequests = onTheBranch(checks('PENDING'))
    const waiting = openWatcher()
    await pollTwice(waiting.watcher)
    githubFake.pullRequests = onTheBranch()
    const restarted = openWatcher({
      liveWorkers: [{ ...WORKER, pullRequest: PULL_REQUEST_URL }]
    })
    await pollTwice(restarted.watcher)
    const restartedAgain = openWatcher({
      liveWorkers: [
        {
          ...WORKER,
          pullRequest: PULL_REQUEST_URL,
          mergeCommand: SQUASH_COMMAND
        }
      ]
    })
    await pollTwice(restartedAgain.watcher)
    githubFake.pullRequests = onTheBranch({
      merged: true,
      mergeCommit: { oid: 'merge-1' }
    })
    await pollTwice(restartedAgain.watcher)

    const wakes = [
      ...waiting.wakes,
      ...restarted.wakes,
      ...restartedAgain.wakes
    ]
    expect(
      new Set(
        wakes.map(({ inputId }) => {
          return inputId
        })
      )
    ).toStrictEqual(new Set(['github:acme/app#42:ready:head-1']))
    expect(restartedAgain.updates).toContainEqual({
      threadId: WORKER.threadId,
      metadata: { mergeCommand: SQUASH_COMMAND }
    })
    expect(restartedAgain.finishes).toMatchObject([
      { outcome: { value: 'success' } }
    ])
  })

  it('posts the green line and records no command with merging turned off', async () => {
    githubFake.pullRequests = onTheBranch()
    const { watcher, updates, wakes, posts } = openWatcher({ merge: false })

    await pollTwice(watcher)

    expect(updates).toStrictEqual([
      { threadId: WORKER.threadId, metadata: { pullRequest: PULL_REQUEST_URL } }
    ])
    expect(wakes).toStrictEqual([])
    expect(posts).toMatchObject([{ line: `Checks green: ${PULL_REQUEST_URL}` }])
  })

  it('wakes the worker with the merge command again once the merge queue ejected the pull request on the same head commit', async () => {
    githubFake.pullRequests = onTheBranch()
    const { watcher, wakes } = openWatcher()
    await pollTwice(watcher)
    githubFake.pullRequests = onTheBranch({ isInMergeQueue: true })
    await pollTwice(watcher)
    githubFake.pullRequests = onTheBranch({
      timelineItems: {
        nodes: [
          { __typename: 'AddedToMergeQueueEvent', id: 'queued-1' },
          {
            __typename: 'RemovedFromMergeQueueEvent',
            id: 'ejected-1',
            reason: 'A required check failed.'
          }
        ]
      }
    })
    await pollTwice(watcher)

    expect(
      wakes
        .map(({ inputId }) => {
          return inputId
        })
        .filter((inputId) => {
          return inputId.includes(':ready:')
        })
    ).toStrictEqual([
      'github:acme/app#42:ready:head-1',
      'github:acme/app#42:ready:head-1:ejected-1'
    ])
  })
})
