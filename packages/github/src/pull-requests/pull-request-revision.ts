import { createHash } from 'node:crypto'
import type { WatchedPullRequest } from '#/api/github-api.ts'

export function revisionOf({
  headRefOid,
  updatedAt,
  merged,
  closed,
  isDraft,
  mergeStateStatus,
  reviewDecision,
  isInMergeQueue,
  statusCheckRollup,
  commits
}: WatchedPullRequest) {
  const statuses = commits.nodes.flatMap(({ commit }) => {
    return (commit.status?.contexts ?? []).map(({ context, state }) => {
      return [context, state]
    })
  })
  const facts = [
    headRefOid,
    updatedAt,
    merged,
    closed,
    isDraft,
    mergeStateStatus,
    reviewDecision,
    isInMergeQueue,
    statusCheckRollup?.state,
    statusCheckRollup?.contexts.checkRunCountsByState,
    statuses
  ]

  return createHash('sha256').update(JSON.stringify(facts)).digest('base64url')
}
