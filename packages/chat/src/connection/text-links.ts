export type TextLink = {
  pattern: RegExp
  toLink: (match: string) => string
}

export function linkText(markdown: string, links: readonly TextLink[]) {
  return links.reduce((text, { pattern, toLink }) => {
    return text.replace(pattern, toLink)
  }, markdown)
}

const LAST_SPACE = /\s(?=\S*$)/u

export function splitAtLastSpace(text: string) {
  const match = LAST_SPACE.exec(text)

  return match === null
    ? { complete: '', rest: text }
    : {
        complete: text.slice(0, match.index + 1),
        rest: text.slice(match.index + 1)
      }
}
