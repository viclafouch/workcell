import { MessageSquareWarningIcon } from 'lucide-react'
import type { FeedbackReport } from '@workcell/core'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '#/components/ui/empty.tsx'
import { FeedbackItem } from './feedback-item.tsx'

const NO_WORKER_THREADS: ReadonlySet<string> = new Set()

type FeedbackListProps = {
  reports: readonly FeedbackReport[]
  showsThread: boolean
  workerThreadIds?: ReadonlySet<string>
}

export const FeedbackList = ({
  reports,
  showsThread,
  workerThreadIds = NO_WORKER_THREADS
}: FeedbackListProps) => {
  if (reports.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageSquareWarningIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>No feedback yet</EmptyTitle>
          <EmptyDescription>
            An agent sends a report here when a tool, a skill or a limit gets in
            its way.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {reports.map((report) => {
        return (
          <FeedbackItem
            key={report.id}
            report={report}
            showsThread={showsThread}
            isWorkerThread={workerThreadIds.has(report.threadId)}
          />
        )
      })}
    </ul>
  )
}
