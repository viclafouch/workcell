export type TicketStateCategory = 'open' | 'closed'

export type TicketState = {
  name: string
  category: TicketStateCategory
}

export type TicketLabel = {
  name: string
  color?: string
}

export type TicketPerson = {
  name: string
  avatarUrl?: string
}

export type Ticket = {
  key: string
  title: string
  url: string
  state: TicketState
  labels: TicketLabel[]
  assignees: TicketPerson[]
  priority?: string
}

export type QueuedTicket = Ticket & {
  blocker?: string
}

export type TicketQueue = {
  tracker: string
  read: () => Promise<QueuedTicket[]>
}
