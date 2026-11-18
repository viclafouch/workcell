type LinearToolNames = {
  readTools: readonly string[]
  writeTools: readonly string[]
  access: 'read' | 'comment' | 'create'
}

const NO_WRITE = 'You write nothing in Linear.'

function writeLines(
  { writeTools, access }: LinearToolNames,
  ownTicket: string | undefined
) {
  if (access === 'create') {
    return [
      `You create a Linear ticket with ${writeTools.join(', ')}, with no id, when an allowed starter asks for one. Any other Linear write is refused.`
    ]
  }

  return access === 'comment' && ownTicket !== undefined
    ? [
        `You comment on ${ownTicket} with ${writeTools.join(', ')}, with no question. Any other Linear write is refused.`
      ]
    : [NO_WRITE]
}

export function linearPrompt(
  tools: LinearToolNames,
  ownTicket: string | undefined
) {
  return [
    `You read Linear with ${tools.readTools.join(', ')}.`,
    'When one of these tools is missing, the Linear server is down: say so, and never guess what a ticket says.',
    ...writeLines(tools, ownTicket)
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
