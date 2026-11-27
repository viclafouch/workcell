import { describe, expect, it } from 'vitest'
import type { StatusContext, WatchedPullRequest } from '#/api/github-api.ts'
import type { PullRequestLines } from '#/prompts/github.ts'
import {
  pullRequestEvents,
  type ReviewGate
} from '#/pull-requests/pull-request-events.ts'

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
  personCheck: ({ check }) => {
    return `cleared by a person: ${check}`
  },
  redRoundCap: ({ rounds }) => {
    return `red ${rounds} times`
  },
  mergeQueueEntry: (pullRequestUrl) => {
    return `queued ${pullRequestUrl}`
  },
  closed: ({ pullRequestUrl }) => {
    return `dropped ${pullRequestUrl}`
  },
  mergeRefused: ({ cause }) => {
    return `refused: ${cause}`
  },
  approvalWait: ({ reviewers }) => {
    return `waiting on ${reviewers.join(', ')}`
  }
}

function pullRequestWith(
  changes: Partial<WatchedPullRequest> = {}
): WatchedPullRequest {
  return {
    number: 42,
    url: PULL_REQUEST_URL,
    merged: false,
    closed: false,
    mergeable: 'MERGEABLE',
    headRefOid: 'head-1',
    updatedAt: '2026-11-20T09:00:00Z',
    mergeCommit: null,
    statusCheckRollup: {
      state: 'SUCCESS',
      contexts: { checkRunCountsByState: [] }
    },
    commits: { nodes: [] },
    reviewThreads: { nodes: [] },
    comments: { nodes: [] },
    reviews: { nodes: [] },
    timelineItems: { nodes: [] },
    isDraft: false,
    mergeStateStatus: 'CLEAN',
    isInMergeQueue: false,
    isMergeQueueEnabled: false,
    reviewDecision: null,
    reviewRequests: { nodes: [] },
    baseRepository: { viewerDefaultMergeMethod: 'SQUASH' },
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
  statusCheckRollup: {
    state: 'PENDING',
    contexts: { checkRunCountsByState: [] }
  },
  commits: {
    nodes: [
      {
        commit: {
          committedDate: '2026-11-20T09:00:00Z',
          status: {
            contexts: [
              {
                id: 'status-owner-review',
                context: 'Owner review',
                state: 'PENDING',
                description: 'Waiting for an owner of @acme/devops.',
                targetUrl: null
              }
            ]
          }
        }
      }
    ]
  }
})

function actionsOf(
  pullRequest: WatchedPullRequest,
  lines?: PullRequestLines,
  merge?: boolean
) {
  return pullRequestEvents({
    repository: REPOSITORY,
    pullRequest,
    viewerLogin: 'host-developer',
    subject: 'TASK-7',
    lines,
    merge
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

function redStatus(context: string): StatusContext {
  return {
    id: `status-${context}`,
    context,
    state: 'FAILURE',
    description: null,
    targetUrl: `https://checks.example.com/${context}`
  }
}

const RED_CHECKS = pullRequestWith({
  statusCheckRollup: {
    state: 'FAILURE',
    contexts: { checkRunCountsByState: [{ state: 'FAILURE', count: 2 }] }
  },
  commits: {
    nodes: [
      {
        commit: {
          committedDate: '2026-11-20T09:00:00Z',
          status: {
            contexts: [redStatus('code/scan'), redStatus('Risk score')]
          }
        }
      }
    ]
  }
})

const FAILED_JOBS = [
  {
    name: 'unit tests',
    url: 'https://github.com/acme/app/actions/runs/7/job/70'
  },
  {
    name: 'Validate risk',
    url: 'https://github.com/acme/app/actions/runs/8/job/80'
  }
]

function redCheckEventsOf(personChecks: readonly string[]) {
  return pullRequestEvents({
    repository: REPOSITORY,
    pullRequest: RED_CHECKS,
    viewerLogin: 'host-developer',
    failedJobs: FAILED_JOBS,
    personChecks
  }).map(({ kind, inputId, action }) => {
    return { kind, inputId, action }
  })
}

const RISK_LINES = [
  {
    kind: 'person-check',
    inputId: 'github:acme/app#42:person-check:head-1:Risk score',
    action: {
      type: 'post',
      line: `Risk score failed on ${PULL_REQUEST_URL}, a person clears it: https://checks.example.com/Risk score`
    }
  },
  {
    kind: 'person-check',
    inputId: 'github:acme/app#42:person-check:head-1:Validate risk',
    action: {
      type: 'post',
      line: `Validate risk failed on ${PULL_REQUEST_URL}, a person clears it: https://github.com/acme/app/actions/runs/8/job/80`
    }
  }
]

describe('the events of a pull request', () => {
  it('posts a line for each failed check that a person clears, and wakes the worker on the others only', () => {
    expect(redCheckEventsOf(['Risk score', 'Validate risk'])).toStrictEqual([
      {
        kind: 'red-check',
        inputId: 'github:acme/app#42:red-check:head-1:code/scan,unit tests',
        action: {
          type: 'wake',
          delivery: 'steer',
          message: `The pull request watcher sends this, not a person. The checks of the pull request ${PULL_REQUEST_URL} failed on head-1. The status "code/scan" failed: https://checks.example.com/code/scan. The job "unit tests" failed: https://github.com/acme/app/actions/runs/7/job/70. Read the log of a failed job with gh run view --job <job> --log-failed, where <job> ends its link. Push a fix, or ask with the question tool when you cannot fix it. Then end your turn.`
        }
      },
      ...RISK_LINES
    ])
    expect(
      redCheckEventsOf([
        'code/scan',
        'Risk score',
        'unit tests',
        'Validate risk'
      ])
    ).toStrictEqual([
      {
        kind: 'person-check',
        inputId: 'github:acme/app#42:person-check:head-1:code/scan',
        action: {
          type: 'post',
          line: `code/scan failed on ${PULL_REQUEST_URL}, a person clears it: https://checks.example.com/code/scan`
        }
      },
      RISK_LINES[0],
      {
        kind: 'person-check',
        inputId: 'github:acme/app#42:person-check:head-1:unit tests',
        action: {
          type: 'post',
          line: `unit tests failed on ${PULL_REQUEST_URL}, a person clears it: https://github.com/acme/app/actions/runs/7/job/70`
        }
      },
      RISK_LINES[1]
    ])
  })

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
        action: {
          type: 'finish',
          report: `Merged: ${PULL_REQUEST_URL}`,
          outcome: { value: 'success' }
        }
      }
    ])
  })

  it('writes the lines and the merged report of the project, the green line with merging turned off', () => {
    expect([
      ...actionsOf(QUEUED, PROJECT_LINES, false),
      ...actionsOf(MERGED, PROJECT_LINES)
    ]).toStrictEqual([
      { type: 'post', line: `green ${PULL_REQUEST_URL}` },
      { type: 'post', line: `queued ${PULL_REQUEST_URL}` },
      {
        type: 'finish',
        report: `shipped ${PULL_REQUEST_URL} for https://tasks.example.com/TASK-7`,
        outcome: { value: 'success' }
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
