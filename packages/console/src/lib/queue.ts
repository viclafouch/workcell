import type { QueuedTicket } from '@workcell/core'
import { countOf } from './count-words.ts'

export const startableTicketsOf = (tickets: readonly QueuedTicket[]) => {
  return tickets.filter(({ blocker }) => {
    return blocker === undefined
  })
}

export const waitSentence = (tracker: string, count: number) => {
  return `${countOf(count, 'ticket waits', 'tickets wait')} in ${tracker}.`
}

export const blockedSentence = (count: number) => {
  if (count === 0) {
    return 'A worker takes them from the top, each time a place frees.'
  }

  return count === 1
    ? '1 cannot start: its cause shows below.'
    : `${count} cannot start: each cause shows below.`
}
