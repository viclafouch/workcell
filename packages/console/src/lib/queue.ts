import type { QueuedTicket } from '@workcell/core'
import { countWord } from './count-words.ts'

export const startableTicketsOf = (tickets: readonly QueuedTicket[]) => {
  return tickets.filter(({ blocker }) => {
    return blocker === undefined
  })
}

export const waitSentence = (tracker: string, count: number) => {
  return count === 1
    ? `One ticket waits in ${tracker}.`
    : `${countWord(count)} tickets wait in ${tracker}.`
}

export const blockedSentence = (count: number) => {
  if (count === 0) {
    return 'A worker takes them from the top.'
  }

  return count === 1
    ? 'One cannot start: its cause shows below.'
    : `${countWord(count)} cannot start: each cause shows below.`
}
