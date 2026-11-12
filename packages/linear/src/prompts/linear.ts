type LinearToolNames = {
  readTools: readonly string[]
  writeTools: readonly string[]
}

function writeLines(
  writeTools: readonly string[],
  ownTicket: string | undefined
) {
  if (writeTools.length === 0) {
    return ['You write nothing in Linear.']
  }

  return ownTicket === undefined
    ? ['You write nothing in Linear.']
    : [
        `You comment on ${ownTicket} with ${writeTools.join(', ')}, with no question. Any other Linear write is refused.`
      ]
}

export function linearPrompt(
  { readTools, writeTools }: LinearToolNames,
  ownTicket: string | undefined
) {
  return [
    `You read Linear with ${readTools.join(', ')}.`,
    'When one of these tools is missing, the Linear server is down: say so, and never guess what a ticket says.',
    ...writeLines(writeTools, ownTicket)
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
