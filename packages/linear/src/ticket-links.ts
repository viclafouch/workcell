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
        String.raw`(?<![\p{L}\p{N}_/-])(?:${keys})-\d+(?![\p{L}\p{N}_-])`,
        'gu'
      ),
      toLink: (ticket: string) => {
        return `[${ticket}](${ticketUrlPrefix}${ticket})`
      }
    }
  ]
}
