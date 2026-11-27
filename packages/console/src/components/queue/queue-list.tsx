import type { QueuedTicket } from '@workcell/core'
import { QueuedTicketItem } from './queued-ticket.tsx'

type QueueListProps = {
  tickets: readonly QueuedTicket[]
  label: string
}

const withPlaces = (tickets: readonly QueuedTicket[]) => {
  let place = 0

  return tickets.map((ticket) => {
    if (ticket.blocker !== undefined) {
      return { ticket, place: null }
    }

    place += 1

    return { ticket, place }
  })
}

export const QueueList = ({ tickets, label }: QueueListProps) => {
  return (
    <ol aria-label={label} className="flex flex-col gap-2">
      {withPlaces(tickets).map(({ ticket, place }) => {
        return (
          <li key={ticket.key}>
            <QueuedTicketItem ticket={ticket} place={place} />
          </li>
        )
      })}
    </ol>
  )
}
