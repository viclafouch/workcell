import { ChevronRightIcon, InboxIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { QueueList } from '#/components/queue/queue-list.tsx'
import { getQueueQueryOpts } from '#/queries/queue.ts'
import type { QueueRead } from '#/server/queue.functions.ts'
import { EmptySection } from './empty-section.tsx'
import { SectionHeading } from './section-heading.tsx'

const UP_NEXT_TICKETS = 3

type UpNextTicketsProps = {
  queue: QueueRead
}

const UpNextTickets = ({ queue }: UpNextTicketsProps) => {
  if ('failure' in queue) {
    return (
      <p data-status="failed" className="text-sm text-status">
        {queue.tracker} gave no queue: {queue.failure}
      </p>
    )
  }

  if (queue.tickets.length === 0) {
    return (
      <EmptySection
        icon={InboxIcon}
        title={`No ticket waits in ${queue.tracker}`}
        description={`A ticket handed to the bot in ${queue.tracker} shows here until a worker takes it.`}
      />
    )
  }

  return (
    <QueueList
      tickets={queue.tickets.slice(0, UP_NEXT_TICKETS)}
      label={`Next tickets in ${queue.tracker}`}
    />
  )
}

export const UpNext = () => {
  const queueQuery = useQuery(getQueueQueryOpts())

  if (queueQuery.data === null || queueQuery.data === undefined) {
    return null
  }

  return (
    <section aria-labelledby="up-next-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <SectionHeading id="up-next-heading">Up next</SectionHeading>
        <Link
          to="/queue"
          className="press inline-flex min-h-6 items-center gap-1 rounded-md text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {'failure' in queueQuery.data
            ? 'Open the queue'
            : `See the whole queue (${queueQuery.data.tickets.length})`}
          <ChevronRightIcon aria-hidden className="size-4" />
        </Link>
      </div>
      <UpNextTickets queue={queueQuery.data} />
    </section>
  )
}
