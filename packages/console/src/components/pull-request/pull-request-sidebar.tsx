import { TagIcon, UserCheckIcon, UsersIcon } from 'lucide-react'
import type { PullRequestDetails } from '@workcell/core'
import { Fact, FactList } from '#/components/facts/fact-list.tsx'
import { PersonLine } from '#/components/ticket/person-line.tsx'
import { TicketLabelChip } from '#/components/ticket/ticket-label.tsx'
import { REVIEW_STATES } from '#/constants/pull-request-status.ts'
import { formatCount } from '#/lib/count-words.ts'

const SHOWN_LABELS = 6

type PullRequestSidebarProps = {
  pullRequest: Pick<PullRequestDetails, 'reviewers' | 'assignees' | 'labels'>
}

export const PullRequestSidebar = ({
  pullRequest: { reviewers, assignees, labels }
}: PullRequestSidebarProps) => {
  return (
    <FactList>
      <Fact
        title="Reviewers"
        icon={UsersIcon}
        isEmpty={reviewers.length === 0}
        empty="None"
      >
        {reviewers.map(({ name, avatarUrl, state }) => {
          const { signal, label } = REVIEW_STATES[state]

          return (
            <span
              key={name}
              className="inline-flex max-w-full min-w-0 items-center gap-2"
            >
              <PersonLine name={name} avatarUrl={avatarUrl} />
              <span
                data-signal={signal}
                className="shrink-0 text-label whitespace-nowrap text-signal"
              >
                {label}
              </span>
            </span>
          )
        })}
      </Fact>
      <Fact
        title="Assignees"
        icon={UserCheckIcon}
        isEmpty={assignees.length === 0}
        empty="No one"
      >
        {assignees.map(({ name, avatarUrl }) => {
          return <PersonLine key={name} name={name} avatarUrl={avatarUrl} />
        })}
      </Fact>
      <Fact
        title="Labels"
        icon={TagIcon}
        isEmpty={labels.length === 0}
        empty="None"
      >
        {labels.slice(0, SHOWN_LABELS).map((label) => {
          return <TicketLabelChip key={label.name} label={label} />
        })}
        {labels.length > SHOWN_LABELS ? (
          <span
            title={labels
              .slice(SHOWN_LABELS)
              .map(({ name }) => {
                return name
              })
              .join(', ')}
            className="text-label text-muted-foreground"
          >
            +{formatCount(labels.length - SHOWN_LABELS)}
            <span className="sr-only"> more labels</span>
          </span>
        ) : null}
      </Fact>
    </FactList>
  )
}
