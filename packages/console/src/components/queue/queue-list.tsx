import type { QueuedTicket } from '@workcell/core'
import { QueuedTicketItem } from './queued-ticket.tsx'

type QueueListProps = {
  tickets: readonly QueuedTicket[]
  label: string
}

const withRanks = (tickets: readonly QueuedTicket[]) => {
  let rank = 0

  return tickets.map((ticket) => {
    if (ticket.blocker !== undefined) {
      return { ticket, rank: null }
    }

    rank += 1

    return { ticket, rank }
  })
}

export const QueueList = ({ tickets, label }: QueueListProps) => {
  return (
    <ol aria-label={label} className="flex flex-col gap-2">
      {withRanks(tickets).map(({ ticket, rank }) => {
        return (
          <li key={ticket.key}>
            <QueuedTicketItem ticket={ticket} rank={rank} />
          </li>
        )
      })}
    </ol>
  )
}
