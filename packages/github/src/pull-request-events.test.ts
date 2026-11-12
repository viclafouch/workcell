import { describe, expect, it } from 'vitest'
import type { PullRequestLines } from '#github/prompts/github'
import type { WatchedPullRequest } from './github-api.ts'
import { pullRequestEvents, type ReviewGate } from './pull-request-events.ts'

const REPOSITORY = 'acme/app'

const PULL_REQUEST_URL = 'https://github.com/acme/app/pull/42'

const REVIEW_GATE: ReviewGate = {
  context: 'Owner review',
  waitingDescriptions: ['Waiting for an owner']
}

const PROJECT_LINES: PullRequestLines = {
  merged: ({ pullRequestUrl, subject }) => {
    return `shipped ${pullRequestUrl} for https://tasks.example.com/${subject}`
  },
  greenCheck: (pullRequestUrl) => {
    return `green ${pullRequestUrl}`
  },
  mergeQueueEntry: (pullRequestUrl) => {
    return `queued ${pullRequestUrl}`
  }
}

function pullRequestWith(
  changes: Partial<WatchedPullRequest> = {}
): WatchedPullRequest {
  return {
    number: 42,
    url: PULL_REQUEST_URL,
    merged: false,
    mergeable: 'MERGEABLE',
    headRefOid: 'head-1',
    mergeCommit: null,
    statusCheckRollup: { state: 'SUCCESS' },
    commits: { nodes: [] },
    reviewThreads: { nodes: [] },
    comments: { nodes: [] },
    reviews: { nodes: [] },
    timelineItems: { nodes: [] },
    ...changes
  }
}

const MERGED = pullRequestWith({
  merged: true,
  mergeCommit: { oid: 'merge-1' }
})

const QUEUED = pullRequestWith({
  timelineItems: {
    nodes: [{ __typename: 'AddedToMergeQueueEvent', id: 'queued-1' }]
  }
})

const WAITING_ON_AN_OWNER = pullRequestWith({
  statusCheckRollup: { state: 'PENDING' },
  commits: {
    nodes: [
      {
        commit: {
          status: {
            contexts: [
              {
                id: 'status-owner-review',
                context: 'Owner review',
                state: 'PENDING',
                description: 'Waiting for an owner of @acme/devops.',
                targetUrl: null,
                isRequired: true
              }
            ]
          }
        }
      }
    ]
  }
})

function actionsOf(pullRequest: WatchedPullRequest, lines?: PullRequestLines) {
  return pullRequestEvents({
    repository: REPOSITORY,
    pullRequest,
    viewerLogin: 'host-developer',
    subject: 'TASK-7',
    lines
  }).map(({ action }) => {
    return action
  })
}

function reviewGateEventsOf(reviewGate?: ReviewGate) {
  return pullRequestEvents({
    repository: REPOSITORY,
    pullRequest: WAITING_ON_AN_OWNER,
    viewerLogin: 'host-developer',
    reviewGate
  }).map(({ kind, action }) => {
    return { kind, action }
  })
}

describe('the events of a pull request', () => {
  it('names only the pull request in the merged report of a task with no subject', () => {
    const events = pullRequestEvents({
      repository: REPOSITORY,
      pullRequest: MERGED,
      viewerLogin: 'host-developer'
    })

    expect(events).toStrictEqual([
      {
        kind: 'merged',
        inputId: 'github:acme/app#42:merged:merge-1',
        action: { type: 'finish', report: `Merged: ${PULL_REQUEST_URL}` }
      }
    ])
  })

  it('writes the lines and the merged report of the project', () => {
    expect([
      ...actionsOf(QUEUED, PROJECT_LINES),
      ...actionsOf(MERGED, PROJECT_LINES)
    ]).toStrictEqual([
      { type: 'post', line: `green ${PULL_REQUEST_URL}` },
      { type: 'post', line: `queued ${PULL_REQUEST_URL}` },
      {
        type: 'finish',
        report: `shipped ${PULL_REQUEST_URL} for https://tasks.example.com/TASK-7`
      }
    ])
  })

  it('wakes the worker on the review gate of the project only', () => {
    expect(reviewGateEventsOf()).toStrictEqual([])
    expect(reviewGateEventsOf(REVIEW_GATE)).toStrictEqual([
      {
        kind: 'review-gate',
        action: {
          type: 'wake',
          delivery: 'followUp',
          message: `The Owner review of the pull request ${PULL_REQUEST_URL} waits: Waiting for an owner of @acme/devops. No change in the code moves it. Say in one line which owner it waits for. Then end your turn.`
        }
      }
    ])
  })
})
