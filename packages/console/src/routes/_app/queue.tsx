import { InboxIcon, TicketIcon, TriangleAlertIcon } from 'lucide-react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import type { QueuedTicket } from '@workcell/core'
import { QueueList } from '#/components/queue/queue-list.tsx'
import {
  blockedSentence,
  startableTicketsOf,
  waitSentence
} from '#/lib/queue.ts'
import { getQueueQueryOpts } from '#/queries/queue.ts'
import { EmptySection } from './-components/empty-section.tsx'

type QueueTicketsProps = {
  tracker: string
  tickets: readonly QueuedTicket[]
}

const QueueTickets = ({ tracker, tickets }: QueueTicketsProps) => {
  const blockedCount = tickets.length - startableTicketsOf(tickets).length

  return (
    <div className="mx-auto flex w-full max-w-panel flex-col gap-8 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl leading-tight font-semibold sm:text-4xl">
          {waitSentence(tracker, tickets.length)}
        </h1>
        {tickets.length === 0 ? null : (
          <p
            data-status={blockedCount === 0 ? 'idle' : 'failed'}
            className="text-lg text-status"
          >
            {blockedSentence(blockedCount)}
          </p>
        )}
      </div>
      {tickets.length === 0 ? (
        <EmptySection
          icon={InboxIcon}
          title="The queue is empty"
          description={`A ticket handed to the bot in ${tracker} shows here until a worker takes it.`}
        />
      ) : (
        <QueueList tickets={tickets} label={`Tickets waiting in ${tracker}`} />
      )}
    </div>
  )
}

const QueuePage = () => {
  const queueQuery = useSuspenseQuery(getQueueQueryOpts())

  if (queueQuery.data === null) {
    return (
      <div className="mx-auto flex w-full max-w-panel flex-col gap-6 px-4 py-8 sm:px-6">
        <EmptySection
          icon={TicketIcon}
          title="This host reads no tracker"
          description="Work reaches the workers through the chat alone, so no ticket waits in line."
        />
      </div>
    )
  }

  if ('failure' in queueQuery.data) {
    return (
      <div className="mx-auto flex w-full max-w-panel flex-col gap-6 px-4 py-8 sm:px-6">
        <EmptySection
          icon={TriangleAlertIcon}
          title={`${queueQuery.data.tracker} gave no queue`}
          description={queueQuery.data.failure}
        />
      </div>
    )
  }

  return (
    <QueueTickets
      tracker={queueQuery.data.tracker}
      tickets={queueQuery.data.tickets}
    />
  )
}

export const Route = createFileRoute('/_app/queue')({
  staticData: { section: 'Overview', crumb: 'Queue' },
  loader: ({ context }) => {
    return context.queryClient.query(getQueueQueryOpts())
  },
  head: () => {
    return { meta: [{ title: 'Queue' }] }
  },
  component: QueuePage
})
