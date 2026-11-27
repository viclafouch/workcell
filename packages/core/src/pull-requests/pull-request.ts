import type { IntegrationMark } from '#/tracker/ticket.ts'

export type PullRequestState = 'open' | 'draft' | 'merged' | 'closed'

export type PullRequestCheckState =
  | 'pending'
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'neutral'

export type PullRequestCheck = {
  name: string
  state: PullRequestCheckState
  url?: string
  description?: string
}

export type PullRequestFileStatus =
  | 'added'
  | 'removed'
  | 'modified'
  | 'renamed'
  | 'copied'
  | 'changed'

export type PullRequestFile = {
  path: string
  status: PullRequestFileStatus
  additions: number
  deletions: number
}

export type PullRequestPerson = {
  name: string
  avatarUrl?: string
}

export type PullRequestLabel = {
  name: string
  color?: string
}

export type PullRequestReviewState =
  | 'requested'
  | 'approved'
  | 'changes-requested'
  | 'commented'

export type PullRequestReviewer = PullRequestPerson & {
  state: PullRequestReviewState
}

export type PullRequestMergeStatus =
  | 'ready'
  | 'blocked'
  | 'checks-failing'
  | 'conflicts'
  | 'behind'
  | 'unknown'

export type PullRequestMerge = {
  mergedAt: string
  mergedBy?: PullRequestPerson
  commit?: string
}

export type PullRequestDetails = {
  key: string
  title: string
  url: string
  description: string
  state: PullRequestState
  author?: PullRequestPerson
  assignees: PullRequestPerson[]
  labels: PullRequestLabel[]
  reviewers: PullRequestReviewer[]
  base: string
  head: string
  headCommit: string
  commitCount: number
  commentCount: number
  updatedAt: string
  isInMergeQueue: boolean
  mergeStatus?: PullRequestMergeStatus
  additions: number
  deletions: number
  checks: PullRequestCheck[]
  hiddenChecks: number
  files: PullRequestFile[]
  fileCount: number
  merge?: PullRequestMerge
  closedAt?: string
}

export type PullRequests = {
  mark?: IntegrationMark
  read: (url: string) => Promise<PullRequestDetails | null>
  diff: (url: string) => Promise<string | null>
}
