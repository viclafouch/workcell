type TicketLinksParams = {
  teamKeys: readonly string[]
  ticketUrlPrefix: string
}

function escaped(text: string) {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
}

export function ticketLinks({ teamKeys, ticketUrlPrefix }: TicketLinksParams) {
  if (teamKeys.length === 0) {
    return []
  }

  const keys = teamKeys.map(escaped).join('|')

  return [
    {
      pattern: new RegExp(
        `(?<![\\w/[-])\`?(?:${keys})-\\d+\`?(?![\\w\\]-])`,
        'gu'
      ),
      toLink: (match: string) => {
        const ticket = match.replaceAll('`', '')

        return `[${ticket}](${ticketUrlPrefix}${ticket})`
      }
    }
  ]
}
