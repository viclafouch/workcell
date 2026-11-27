import type { PullRequestDetails } from '@workcell/core'
import { Hint } from '#/components/status/hint.tsx'
import {
  PULL_REQUEST_STATES,
  pullRequestStateKeyOf
} from '#/constants/pull-request-status.ts'

type PullRequestStatePillProps = {
  pullRequest: Pick<PullRequestDetails, 'state' | 'isInMergeQueue'>
  size?: 'sm' | 'md'
}

export const PullRequestStatePill = ({
  pullRequest,
  size = 'md'
}: PullRequestStatePillProps) => {
  const key = pullRequestStateKeyOf(pullRequest)
  const { label, hint, icon: Icon } = PULL_REQUEST_STATES[key]

  return (
    <Hint label={hint}>
      <span data-state={key} data-size={size} className="state-label">
        <Icon aria-hidden />
        {label}
      </span>
    </Hint>
  )
}
