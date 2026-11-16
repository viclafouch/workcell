import type { WakeWorkerParams } from '@workcell/core'
import type {
  Author,
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

const REVIEW_STATES_THAT_WAKE = new Set(['CHANGES_REQUESTED', 'COMMENTED'])

const END_TURN = 'Then end your turn.'

type PullRequestEventKind =
  | 'red-check'
  | 'green-check'
  | 'review-comment'
  | 'comment'
  | 'review'
  | 'conflict'
  | 'review-gate'
  | 'merge-queue-entry'
  | 'merge-queue-ejection'
  | 'merged'

type PullRequestAction =
  | { type: 'wake'; delivery: WakeWorkerParams['delivery']; message: string }
  | { type: 'post'; line: string }
  | { type: 'finish'; report: string }

export type PullRequestEvent = {
  kind: PullRequestEventKind
  inputId: string
  action: PullRequestAction
}

type EventFacts = Pick<PullRequestEvent, 'kind' | 'action'> & { id: string }

type EventOf = (facts: EventFacts) => PullRequestEvent

export type ReviewGate = {
  context: string
  waitingDescriptions: readonly string[]
}

type PullRequestEventsParams = {
  repository: string
  pullRequest: WatchedPullRequest
  viewerLogin: string
  subject?: string
  lines?: PullRequestLines
  reviewGate?: ReviewGate
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

function redStatusesText(
  statuses: readonly StatusContext[],
  reviewGate: ReviewGate | undefined
) {
  return statuses
    .filter(({ context, state, isRequired }) => {
      return (
        isRequired && RED_STATES.has(state) && context !== reviewGate?.context
      )
    })
    .map(({ context, targetUrl }) => {
      return ` The required status "${context}" failed: ${targetUrl ?? 'no link'}.`
    })
    .join('')
}

function redCheckEvents(
  pullRequest: WatchedPullRequest,
  reviewGate: ReviewGate | undefined,
  eventOf: EventOf
) {
  const { statusCheckRollup, headRefOid, url } = pullRequest

  if (!RED_STATES.has(statusCheckRollup?.state ?? '')) {
    return []
  }

  return [
    eventOf({
      kind: 'red-check',
      id: headRefOid,
      action: wake(
        'steer',
        `The checks of the pull request ${url} are red on ${headRefOid}.${redStatusesText(statusesOf(pullRequest), reviewGate)} Read the failed GitHub Actions jobs with gh run list --commit ${headRefOid}, then gh run view <run> --log-failed. Push a fix, or ask with the question tool when you cannot fix it. ${END_TURN}`
      )
    })
  ]
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
    .filter(({ author, state, body }) => {
      return (
        !isOwnOrGhost(author, viewerLogin) &&
        !isBot(author) &&
        REVIEW_STATES_THAT_WAKE.has(state) &&
        (state === 'CHANGES_REQUESTED' || body.trim() !== '')
      )
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
  reviewGate
}: PullRequestEventsParams): PullRequestEvent[] {
  const { number, url, merged, mergeCommit, mergeable, headRefOid } =
    pullRequest
  const eventOf: EventOf = ({ kind, id, action }) => {
    return {
      kind,
      inputId: `github:${repository}#${number}:${kind}:${id}`,
      action
    }
  }

  if (merged) {
    return [
      eventOf({
        kind: 'merged',
        id: mergeCommit?.oid ?? headRefOid,
        action: {
          type: 'finish',
          report: lines.merged({ pullRequestUrl: url, subject })
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

  return [
    ...redCheckEvents(pullRequest, reviewGate, eventOf),
    ...greenCheckEvents(pullRequest, lines, eventOf),
    ...commentEvents(pullRequest, viewerLogin, eventOf),
    ...conflictEvents,
    ...reviewGateEvents(pullRequest, reviewGate, eventOf),
    ...mergeQueueEvents(pullRequest, lines, eventOf)
  ]
}
