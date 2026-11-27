import {
  CheckIcon,
  CircleIcon,
  CircleMinusIcon,
  CircleSlashIcon,
  GitMergeIcon,
  GitPullRequestArrowIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  XIcon,
  type LucideIcon
} from 'lucide-react'
import type {
  PullRequestCheck,
  PullRequestCheckState,
  PullRequestDetails,
  PullRequestMergeStatus,
  PullRequestReviewState
} from '@workcell/core'
import { formatCount } from '#/lib/count-words.ts'

export type Signal = 'success' | 'danger' | 'attention' | 'done' | 'neutral'

export type PullRequestStateKey = PullRequestDetails['state'] | 'queued'

type StateLook = {
  label: string
  hint: string
  icon: LucideIcon
}

export const PULL_REQUEST_STATES = {
  open: {
    label: 'Open',
    hint: 'The pull request waits for its checks and its merge.',
    icon: GitPullRequestIcon
  },
  draft: {
    label: 'Draft',
    hint: 'The pull request is a draft: it cannot merge yet.',
    icon: GitPullRequestDraftIcon
  },
  queued: {
    label: 'Queued',
    hint: 'The pull request waits its turn in the merge queue of its base branch.',
    icon: GitPullRequestArrowIcon
  },
  merged: {
    label: 'Merged',
    hint: 'The change landed on its base branch.',
    icon: GitMergeIcon
  },
  closed: {
    label: 'Closed',
    hint: 'The pull request closed without a merge.',
    icon: GitPullRequestClosedIcon
  }
} as const satisfies Record<PullRequestStateKey, StateLook>

export const pullRequestStateKeyOf = ({
  state,
  isInMergeQueue
}: Pick<
  PullRequestDetails,
  'state' | 'isInMergeQueue'
>): PullRequestStateKey => {
  return state === 'open' && isInMergeQueue ? 'queued' : state
}

type SignalLook = {
  signal: Signal
  label: string
}

type CheckLook = SignalLook & {
  icon: LucideIcon
}

export const CHECK_STATUSES = {
  pending: { signal: 'attention', label: 'Running', icon: CircleIcon },
  success: { signal: 'success', label: 'Passed', icon: CheckIcon },
  failure: { signal: 'danger', label: 'Failed', icon: XIcon },
  cancelled: { signal: 'neutral', label: 'Cancelled', icon: CircleSlashIcon },
  skipped: { signal: 'neutral', label: 'Skipped', icon: CircleSlashIcon },
  neutral: { signal: 'neutral', label: 'Neutral', icon: CircleMinusIcon }
} as const satisfies Record<PullRequestCheckState, CheckLook>

export const MERGE_STATUSES = {
  ready: { signal: 'success', label: 'Ready to merge' },
  blocked: {
    signal: 'danger',
    label: 'Merge blocked: a required check or review is missing'
  },
  'checks-failing': {
    signal: 'attention',
    label: 'Mergeable, with checks that fail'
  },
  conflicts: { signal: 'danger', label: 'Conflicts with its base branch' },
  behind: { signal: 'attention', label: 'Behind its base branch' },
  unknown: { signal: 'neutral', label: 'Merge status not known yet' }
} as const satisfies Record<PullRequestMergeStatus, SignalLook>

export const REVIEW_STATES = {
  requested: { signal: 'attention', label: 'Review requested' },
  approved: { signal: 'success', label: 'Approved' },
  'changes-requested': { signal: 'danger', label: 'Changes requested' },
  commented: { signal: 'neutral', label: 'Commented' }
} as const satisfies Record<PullRequestReviewState, SignalLook>

const countOf = (
  checks: readonly PullRequestCheck[],
  state: PullRequestCheckState
) => {
  return checks.filter((check) => {
    return check.state === state
  }).length
}

export const checksSummaryOf = (
  checks: readonly PullRequestCheck[],
  hiddenChecks: number
): SignalLook => {
  const failing = countOf(checks, 'failure')
  const running = countOf(checks, 'pending')

  if (failing > 0) {
    return {
      signal: 'danger',
      label: `${formatCount(failing)} of ${formatCount(checks.length)} failing`
    }
  }

  if (running > 0) {
    return {
      signal: 'attention',
      label: `${formatCount(running)} of ${formatCount(checks.length)} running`
    }
  }

  if (checks.length === 0) {
    return {
      signal: 'neutral',
      label: hiddenChecks === 0 ? 'No checks reported' : 'Checks hidden'
    }
  }

  return {
    signal: 'success',
    label:
      hiddenChecks === 0 ? 'All checks passed' : 'All readable checks passed'
  }
}
