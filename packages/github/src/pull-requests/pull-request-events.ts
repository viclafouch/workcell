import type { TaskEnd, WakeWorkerParams } from '@workcell/core'
import type {
  Author,
  FailedJob,
  StatusContext,
  WatchedPullRequest
} from '#/api/github-api.ts'
import {
  PULL_REQUEST_LINES,
  REPLY_TOOL_NAME,
  RESOLVE_TOOL_NAME,
  REVIEW_THREADS_TOOL_NAME,
  type PullRequestLines
} from '#/prompts/github.ts'

const RED_STATES = new Set(['FAILURE', 'ERROR'])

const FAILED_CHECK_RUN_STATES = new Set(['FAILURE', 'TIMED_OUT'])

const REVIEW_STATES_THAT_WAKE = new Set(['CHANGES_REQUESTED', 'COMMENTED'])

const END_TURN = 'Then end your turn.'

type PullRequestEventKind =
  | 'red-check'
  | 'red-round-cap'
  | 'person-check'
  | 'green-check'
  | 'ready'
  | 'approval-wait'
  | 'review-comment'
  | 'comment'
  | 'review'
  | 'conflict'
  | 'review-gate'
  | 'merge-queue-entry'
  | 'merge-queue-ejection'
  | 'merged'
  | 'closed'
  | 'merge-refused'

type PullRequestAction =
  | { type: 'wake'; delivery: WakeWorkerParams['delivery']; message: string }
  | { type: 'post'; line: string }
  | { type: 'merge'; command: string; message: string }
  | { type: 'finish'; report: string; outcome: TaskEnd }

export type PullRequestEvent = {
  kind: PullRequestEventKind
  inputId: string
  action: PullRequestAction
  redCommit?: string
}

type IsAnAskParams = Pick<
  WatchedPullRequest['reviews']['nodes'][number],
  'state' | 'body'
>

type EventFacts = Pick<PullRequestEvent, 'kind' | 'action' | 'redCommit'> & {
  id: string
}

type EventOf = (facts: EventFacts) => PullRequestEvent

export type ReviewGate = {
  context: string
  waitingDescriptions: readonly string[]
}

type RedCheck = { kind: 'status' | 'job'; name: string; url: string | null }

export type RedCommits = {
  max: number
  recorded: readonly string[]
}

type PullRequestEventsParams = {
  repository: string
  pullRequest: WatchedPullRequest
  viewerLogin: string
  subject?: string
  lines?: PullRequestLines
  reviewGate?: ReviewGate
  failedJobs?: readonly FailedJob[]
  personChecks?: readonly string[]
  redCommits?: RedCommits
  merge?: boolean
  mergeRefusal?: string
  starterId?: string
}

type RedCheckParams = {
  redChecks: readonly RedCheck[]
  personChecks: readonly string[]
  lines: PullRequestLines
  redCommits: RedCommits | undefined
}

function wake(
  delivery: WakeWorkerParams['delivery'],
  message: string
): PullRequestAction {
  return { type: 'wake', delivery, message }
}

function post(line: string): PullRequestAction {
  return { type: 'post', line }
}

function isBot(author: Author) {
  return author?.__typename === 'Bot'
}

function isOwnOrGhost(author: Author, viewerLogin: string) {
  return author === null || author.login === viewerLogin
}

function statusesOf({ commits }: WatchedPullRequest): StatusContext[] {
  return commits.nodes.flatMap(({ commit }) => {
    return commit.status?.contexts ?? []
  })
}

export function failedCheckRunCount({ statusCheckRollup }: WatchedPullRequest) {
  if (!RED_STATES.has(statusCheckRollup?.state ?? '')) {
    return 0
  }

  return (statusCheckRollup?.contexts.checkRunCountsByState ?? [])
    .filter(({ state }) => {
      return FAILED_CHECK_RUN_STATES.has(state)
    })
    .reduce((total, { count }) => {
      return total + count
    }, 0)
}

function redStatuses(
  statuses: readonly StatusContext[],
  reviewGate: ReviewGate | undefined
): RedCheck[] {
  return statuses
    .filter(({ context, state }) => {
      return RED_STATES.has(state) && context !== reviewGate?.context
    })
    .map(({ context, targetUrl }) => {
      return { kind: 'status', name: context, url: targetUrl }
    })
}

function redCheckText({ kind, name, url }: RedCheck) {
  return ` The ${kind} "${name}" failed: ${url ?? 'no link'}.`
}

function roundOf(headRefOid: string, { recorded }: RedCommits) {
  const index = recorded.indexOf(headRefOid)

  return (index === -1 ? recorded.length : index) + 1
}

type RedRoundEventParams = {
  pullRequest: WatchedPullRequest
  redCommits: RedCommits | undefined
  lines: PullRequestLines
  wakeEvent: () => PullRequestEvent
  eventOf: EventOf
}

function redRoundEvent({
  pullRequest: { headRefOid, url },
  redCommits,
  lines,
  wakeEvent,
  eventOf
}: RedRoundEventParams) {
  if (redCommits === undefined) {
    return wakeEvent()
  }

  const round = roundOf(headRefOid, redCommits)

  return round > redCommits.max
    ? eventOf({
        kind: 'red-round-cap',
        id: headRefOid,
        action: post(lines.redRoundCap({ pullRequestUrl: url, rounds: round })),
        redCommit: headRefOid
      })
    : { ...wakeEvent(), redCommit: headRefOid }
}

function currentRedChecks(
  pullRequest: WatchedPullRequest,
  reviewGate: ReviewGate | undefined,
  failedJobs: readonly FailedJob[]
): RedCheck[] {
  if (!RED_STATES.has(pullRequest.statusCheckRollup?.state ?? '')) {
    return []
  }

  return [
    ...redStatuses(statusesOf(pullRequest), reviewGate),
    ...failedJobs.map(({ name, url: jobUrl }): RedCheck => {
      return { kind: 'job', name, url: jobUrl }
    })
  ]
}

function redCheckEvents(
  pullRequest: WatchedPullRequest,
  { redChecks, personChecks, lines, redCommits }: RedCheckParams,
  eventOf: EventOf
) {
  const { headRefOid, url } = pullRequest

  const clearedByAPerson = ({ name }: RedCheck) => {
    return personChecks.includes(name)
  }
  const workerChecks = redChecks.filter((check) => {
    return !clearedByAPerson(check)
  })
  const wakeEvent = () => {
    return eventOf({
      kind: 'red-check',
      id: `${headRefOid}:${workerChecks
        .map(({ name }) => {
          return name
        })
        .join(',')}`,
      action: wake(
        'steer',
        `The pull request watcher sends this, not a person. The checks of the pull request ${url} failed on ${headRefOid}.${workerChecks.map(redCheckText).join('')} Read the log of a failed job with gh run view --job <job> --log-failed, where <job> ends its link. Push a fix, or ask with the question tool when you cannot fix it. ${END_TURN}`
      )
    })
  }
  const wakeEvents =
    workerChecks.length === 0
      ? []
      : [
          redRoundEvent({
            pullRequest,
            redCommits,
            lines,
            wakeEvent,
            eventOf
          })
        ]
  const personEvents = redChecks
    .filter(clearedByAPerson)
    .map(({ name, url: checkUrl }) => {
      return eventOf({
        kind: 'person-check',
        id: `${headRefOid}:${name}`,
        action: post(
          lines.personCheck({ pullRequestUrl: url, check: name, checkUrl })
        )
      })
    })

  return [...wakeEvents, ...personEvents]
}

const MERGE_METHOD_FLAGS = {
  MERGE: '--merge',
  SQUASH: '--squash',
  REBASE: '--rebase'
} as const

const REVIEW_DECISIONS_THAT_WAIT = new Set([
  'REVIEW_REQUIRED',
  'CHANGES_REQUESTED'
])

const MERGE_STATES_THAT_MERGE = new Set(['CLEAN', 'HAS_HOOKS'])

function isGreen(
  { statusCheckRollup }: WatchedPullRequest,
  redChecks: readonly RedCheck[]
) {
  const state = statusCheckRollup?.state

  return (
    state === undefined ||
    state === 'SUCCESS' ||
    (RED_STATES.has(state) && redChecks.length === 0)
  )
}

function lastEjectionOf({ timelineItems }: WatchedPullRequest) {
  return timelineItems.nodes.findLast(({ __typename }) => {
    return __typename === 'RemovedFromMergeQueueEvent'
  })?.id
}

function isReady(
  pullRequest: WatchedPullRequest,
  redChecks: readonly RedCheck[]
) {
  const {
    mergeStateStatus,
    isDraft,
    isInMergeQueue,
    reviewDecision,
    reviewThreads
  } = pullRequest

  return (
    MERGE_STATES_THAT_MERGE.has(mergeStateStatus) &&
    isGreen(pullRequest, redChecks) &&
    !isDraft &&
    !isInMergeQueue &&
    !REVIEW_DECISIONS_THAT_WAIT.has(reviewDecision ?? '') &&
    reviewThreads.nodes.every(({ isResolved }) => {
      return isResolved
    })
  )
}

function mergeCommandOf({
  url,
  headRefOid,
  isMergeQueueEnabled,
  baseRepository
}: WatchedPullRequest) {
  const method = isMergeQueueEnabled
    ? []
    : [MERGE_METHOD_FLAGS[baseRepository?.viewerDefaultMergeMethod ?? 'MERGE']]

  return [
    'gh pr merge',
    url,
    ...method,
    '--match-head-commit',
    headRefOid
  ].join(' ')
}

function readyEvents(
  pullRequest: WatchedPullRequest,
  redChecks: readonly RedCheck[],
  eventOf: EventOf
) {
  if (!isReady(pullRequest, redChecks)) {
    return []
  }

  const { url, headRefOid } = pullRequest
  const command = mergeCommandOf(pullRequest)
  const lastEjection = lastEjectionOf(pullRequest)

  return [
    eventOf({
      kind: 'ready',
      id:
        lastEjection === undefined
          ? headRefOid
          : `${headRefOid}:${lastEjection}`,
      action: {
        type: 'merge',
        command,
        message: `The pull request watcher sends this, not a person. The pull request ${url} is ready: its checks are green on ${headRefOid}. Merge it with this exact command, and no other: ${command} GitHub can take minutes to merge it, through its merge queue: the merge reaches the host on its own, so watch nothing and ask no one. When GitHub refuses it, change nothing: the host ends the task. ${END_TURN}`
      }
    })
  ]
}

function reviewerNamesOf({ reviewRequests }: WatchedPullRequest) {
  return (reviewRequests?.nodes ?? []).flatMap((request) => {
    const reviewer = request?.requestedReviewer

    if (reviewer?.__typename === 'User') {
      return [`@${reviewer.login}`]
    }

    return reviewer?.__typename === 'Team' ? [`@${reviewer.slug}`] : []
  })
}

type ApprovalWaitParams = {
  redChecks: readonly RedCheck[]
  lines: PullRequestLines
}

function approvalWaitEvents(
  pullRequest: WatchedPullRequest,
  { redChecks, lines }: ApprovalWaitParams,
  eventOf: EventOf
) {
  const { reviewDecision, headRefOid, url } = pullRequest

  return isGreen(pullRequest, redChecks) && reviewDecision === 'REVIEW_REQUIRED'
    ? [
        eventOf({
          kind: 'approval-wait',
          id: headRefOid,
          action: post(
            lines.approvalWait({
              pullRequestUrl: url,
              reviewers: reviewerNamesOf(pullRequest)
            })
          )
        })
      ]
    : []
}

function greenCheckEvents(
  { statusCheckRollup, headRefOid, url }: WatchedPullRequest,
  lines: PullRequestLines,
  eventOf: EventOf
) {
  return statusCheckRollup?.state === 'SUCCESS'
    ? [
        eventOf({
          kind: 'green-check',
          id: headRefOid,
          action: post(lines.greenCheck(url))
        })
      ]
    : []
}

function reviewGateEvents(
  pullRequest: WatchedPullRequest,
  reviewGate: ReviewGate | undefined,
  eventOf: EventOf
) {
  const { headRefOid, url } = pullRequest
  const gate = statusesOf(pullRequest).find(({ context }) => {
    return context === reviewGate?.context
  })

  if (reviewGate === undefined || gate?.state !== 'PENDING') {
    return []
  }

  const description = gate.description ?? ''
  const waitsOnAnOwner = reviewGate.waitingDescriptions.some((start) => {
    return description.startsWith(start)
  })

  return waitsOnAnOwner
    ? [
        eventOf({
          kind: 'review-gate',
          id: `${headRefOid}:${description}`,
          action: wake(
            'followUp',
            `The ${reviewGate.context} of the pull request ${url} waits: ${description} No change in the code moves it. Say in one line which owner it waits for. ${END_TURN}`
          )
        })
      ]
    : []
}

function commentEvents(
  { reviewThreads, comments, reviews, url }: WatchedPullRequest,
  viewerLogin: string,
  eventOf: EventOf
) {
  const threadEvents = reviewThreads.nodes
    .filter(({ isResolved }) => {
      return !isResolved
    })
    .flatMap(({ comments: threadComments }) => {
      return threadComments.nodes
    })
    .filter(({ author }) => {
      return !isOwnOrGhost(author, viewerLogin)
    })
    .map(({ id, url: commentUrl, author }) => {
      return eventOf({
        kind: 'review-comment',
        id,
        action: wake(
          'steer',
          `${author?.login} commented on a review thread of the pull request ${url}: ${commentUrl}. Read the thread with ${REVIEW_THREADS_TOOL_NAME}. Push a fix, or keep the code with a reason. Reply on the thread with ${REPLY_TOOL_NAME}, then resolve it with ${RESOLVE_TOOL_NAME}. ${END_TURN}`
        )
      })
    })
  const conversationEvents = comments.nodes
    .filter(({ author }) => {
      return !isOwnOrGhost(author, viewerLogin) && !isBot(author)
    })
    .map(({ id, url: commentUrl, author }) => {
      return eventOf({
        kind: 'comment',
        id,
        action: wake(
          'steer',
          `${author?.login} commented on the pull request ${url}: ${commentUrl}. Read the comment, then push a fix, or reply on the pull request. ${END_TURN}`
        )
      })
    })
  const reviewEvents = reviews.nodes
    .filter((review) => {
      return isAPerson(review.author, viewerLogin) && isAnAsk(review)
    })
    .map(({ id, url: reviewUrl, author, state }) => {
      const verdict =
        state === 'CHANGES_REQUESTED' ? ' and asked for changes' : ''

      return eventOf({
        kind: 'review',
        id,
        action: wake(
          'steer',
          `${author?.login} reviewed the pull request ${url}${verdict}: ${reviewUrl}. Read the review, then push a fix, or reply on the pull request. ${END_TURN}`
        )
      })
    })

  return [...threadEvents, ...conversationEvents, ...reviewEvents]
}

function isAPerson(author: Author, viewerLogin: string) {
  return !isOwnOrGhost(author, viewerLogin) && !isBot(author)
}

function isAnAsk({ state, body }: IsAnAskParams) {
  return (
    REVIEW_STATES_THAT_WAKE.has(state) &&
    (state === 'CHANGES_REQUESTED' || body.trim() !== '')
  )
}

function mergeOutcome(
  { commits, reviewThreads, comments, reviews }: WatchedPullRequest,
  viewerLogin: string
): TaskEnd {
  const lastCommit = commits.nodes.at(-1)?.commit.committedDate

  if (lastCommit === undefined) {
    return { value: 'success' }
  }

  const lastCommitAt = Temporal.Instant.from(lastCommit)
  const asks = [
    ...reviewThreads.nodes.flatMap(({ comments: threadComments }) => {
      return threadComments.nodes
    }),
    ...comments.nodes,
    ...reviews.nodes.filter(isAnAsk)
  ]
  const isFixedAfterAnAsk = asks.some(({ author, createdAt }) => {
    return (
      isAPerson(author, viewerLogin) &&
      Temporal.Instant.compare(Temporal.Instant.from(createdAt), lastCommitAt) <
        0
    )
  })

  return { value: isFixedAfterAnAsk ? 'flawed' : 'success' }
}

function mergeQueueEvents(
  { timelineItems, url }: WatchedPullRequest,
  lines: PullRequestLines,
  eventOf: EventOf
) {
  return timelineItems.nodes.map((item) => {
    return item.__typename === 'AddedToMergeQueueEvent'
      ? eventOf({
          kind: 'merge-queue-entry',
          id: item.id,
          action: post(lines.mergeQueueEntry(url))
        })
      : eventOf({
          kind: 'merge-queue-ejection',
          id: item.id,
          action: wake(
            'steer',
            `The merge queue ejected the pull request ${url}: ${item.reason ?? 'no reason given'}. Read the failed checks of the merge queue, then push a fix, or ask with the question tool when you cannot fix it. ${END_TURN}`
          )
        })
  })
}

export function pullRequestEvents({
  repository,
  pullRequest,
  viewerLogin,
  subject,
  lines = PULL_REQUEST_LINES,
  reviewGate,
  failedJobs = [],
  personChecks = [],
  redCommits,
  merge = true,
  mergeRefusal,
  starterId
}: PullRequestEventsParams): PullRequestEvent[] {
  const { number, url, merged, closed, mergeCommit, mergeable, headRefOid } =
    pullRequest
  const eventOf: EventOf = ({ kind, id, action, redCommit }) => {
    return {
      kind,
      inputId: `github:${repository}#${number}:${kind}:${id}`,
      action,
      ...(redCommit === undefined ? {} : { redCommit })
    }
  }

  if (merged) {
    return [
      eventOf({
        kind: 'merged',
        id: mergeCommit?.oid ?? headRefOid,
        action: {
          type: 'finish',
          report: lines.merged({ pullRequestUrl: url, subject }),
          outcome: mergeOutcome(pullRequest, viewerLogin)
        }
      })
    ]
  }

  if (closed) {
    return [
      eventOf({
        kind: 'closed',
        id: headRefOid,
        action: {
          type: 'finish',
          report: lines.closed({ pullRequestUrl: url, subject }),
          outcome: {
            value: 'manual',
            cause: 'A person closed the pull request unmerged.'
          }
        }
      })
    ]
  }

  if (mergeRefusal !== undefined) {
    return [
      eventOf({
        kind: 'merge-refused',
        id: headRefOid,
        action: {
          type: 'finish',
          report: lines.mergeRefused({
            pullRequestUrl: url,
            subject,
            cause: mergeRefusal,
            starterId
          }),
          outcome: {
            value: 'blocked',
            cause: `GitHub refused the merge: ${mergeRefusal}`
          }
        }
      })
    ]
  }

  const conflictEvents =
    mergeable === 'CONFLICTING'
      ? [
          eventOf({
            kind: 'conflict',
            id: headRefOid,
            action: wake(
              'steer',
              `The pull request ${url} has a conflict with its base branch. Merge the base branch into your branch, solve the conflict, run the checks of the files you touched, and push. ${END_TURN}`
            )
          })
        ]
      : []

  const redChecks = currentRedChecks(pullRequest, reviewGate, failedJobs)

  return [
    ...redCheckEvents(
      pullRequest,
      { redChecks, personChecks, lines, redCommits },
      eventOf
    ),
    ...(merge
      ? [
          ...readyEvents(pullRequest, redChecks, eventOf),
          ...approvalWaitEvents(pullRequest, { redChecks, lines }, eventOf)
        ]
      : greenCheckEvents(pullRequest, lines, eventOf)),
    ...commentEvents(pullRequest, viewerLogin, eventOf),
    ...conflictEvents,
    ...reviewGateEvents(pullRequest, reviewGate, eventOf),
    ...mergeQueueEvents(pullRequest, lines, eventOf)
  ]
}
