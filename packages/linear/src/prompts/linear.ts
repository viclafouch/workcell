export const TICKET_CREATION = 'create a Linear ticket'

export function noWriteLine() {
  return 'You write nothing in Linear.'
}

export function commentLine(ownTicket: string, tool: string) {
  return `You comment on ${ownTicket} with ${tool}, with no question. Any other Linear write is refused.`
}

export function createLine(tool: string) {
  return `You create a Linear ticket with ${tool}, with no id, when an allowed starter asks for one. Any other Linear write is refused.`
}

export function linearPrompt(readTools: readonly string[], writeLine: string) {
  return [
    `You read Linear with ${readTools.join(', ')}.`,
    'When one of these tools is missing, the Linear server is down: say so, and never guess what a ticket says.',
    writeLine
  ].join('\n')
}

type TicketTaskParams = {
  identifier: string
  title: string
  url: string
  repository: string
}

export function ticketTask({
  identifier,
  title,
  url,
  repository
}: TicketTaskParams) {
  return `Take the Linear ticket ${identifier} "${title}" (${url}) to a pull request on ${repository}.`
}

export function ticketFact(ticket: string) {
  return `The ticket of this task: ${ticket}.`
}
