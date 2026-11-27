import { Link } from '@tanstack/react-router'
import type { FeedbackReport } from '@workcell/core'
import { Hint } from '#/components/status/hint.tsx'
import { StatusPill } from '#/components/status/status-pill.tsx'
import { Badge } from '#/components/ui/badge.tsx'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemHeader,
  ItemTitle
} from '#/components/ui/item.tsx'
import type { WorkerStatus } from '#/constants/worker-status.ts'
import { formatDateTime } from '#/lib/dates.ts'

const KIND_LABELS = {
  missing: 'Missing',
  broken: 'Broken',
  confusing: 'Confusing',
  idea: 'Idea'
} as const satisfies Record<FeedbackReport['kind'], string>

const KIND_HINTS = {
  missing: 'A tool or a skill it needed does not exist.',
  broken: 'A tool failed or answered wrong.',
  confusing: 'A tool or a rule worked, but its answer misled the agent.',
  idea: 'The agent proposes something that would help.'
} as const satisfies Record<FeedbackReport['kind'], string>

const IMPACT_STATUSES = {
  blocked: {
    tone: 'failed',
    label: 'Blocked the task',
    hint: 'The agent could not go on without it.'
  },
  worked_around: {
    tone: 'waiting',
    label: 'Worked around it',
    hint: 'The agent found another way, at a cost.'
  },
  friction: {
    tone: 'idle',
    label: 'Slowed it down',
    hint: 'The agent went on, slower.'
  }
} as const satisfies Record<FeedbackReport['impact'], WorkerStatus>

type FeedbackItemProps = {
  report: FeedbackReport
  showsThread: boolean
  isWorkerThread: boolean
}

const LINK_CLASS = 'text-foreground underline-offset-4 hover:underline'

export const FeedbackItem = ({
  report,
  showsThread,
  isWorkerThread
}: FeedbackItemProps) => {
  return (
    <Item render={<li />} variant="outline">
      <ItemHeader className="flex-wrap justify-start gap-2">
        <Hint label={KIND_HINTS[report.kind]}>
          <Badge variant="secondary">{KIND_LABELS[report.kind]}</Badge>
        </Hint>
        <StatusPill status={IMPACT_STATUSES[report.impact]} />
        {report.tool === undefined ? null : (
          <Hint label="The tool it reports on">
            <Badge variant="outline" className="font-mono">
              {report.tool}
            </Badge>
          </Hint>
        )}
        <time
          dateTime={report.at}
          className="ml-auto text-label text-muted-foreground"
        >
          {formatDateTime(report.at)}
        </time>
      </ItemHeader>
      <ItemContent>
        <ItemTitle dir="auto" className="wrap-anywhere">
          {report.observed}
        </ItemTitle>
        <ItemDescription dir="auto" className="wrap-anywhere">
          Expected: {report.expected}
        </ItemDescription>
      </ItemContent>
      {showsThread ? (
        <ItemFooter className="justify-start text-label text-muted-foreground">
          Sent by {report.source === 'user' ? 'a person, through ' : ''}
          {isWorkerThread ? (
            <Link
              to="/workers/$threadId"
              params={{ threadId: report.threadId }}
              className={LINK_CLASS}
            >
              {report.agent ?? 'a worker'}
            </Link>
          ) : (
            <Link
              to="/threads/$threadId"
              params={{ threadId: report.threadId }}
              className={LINK_CLASS}
            >
              {report.agent ?? 'the bot'}
            </Link>
          )}
        </ItemFooter>
      ) : null}
    </Item>
  )
}
