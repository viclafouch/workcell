export type TicketStateCategory = 'open' | 'closed'

export type TicketState = {
  name: string
  category: TicketStateCategory
  color?: string
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

export type TicketDetails = Ticket & {
  description: string
}

export type IntegrationMark = {
  name: string
  iconUrl: string
  color?: string
}

export type Tracker = {
  name: string
  mark?: IntegrationMark
  queue: () => Promise<QueuedTicket[]>
  ticket: (key: string) => Promise<TicketDetails | null>
}
