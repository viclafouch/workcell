export type TextLink = {
  pattern: RegExp
  toLink: (match: string) => string
}

const CLOSED_MARKUP = /```[\s\S]*?```|`[^`\n]*`|\[[^\]\n]*\]\([^)\s]*\)/uy

const OPEN_LINK = /^\[[^\]\n]*(?:\](?:\([^)\s]*)?)?$/u

const INLINE_CODE = /^`([^`\n]*)`$/u

const LAST_SPACE = /\s(?=\S*$)/u

function closedMarkupAt(text: string, index: number) {
  CLOSED_MARKUP.lastIndex = index

  return CLOSED_MARKUP.exec(text)?.[0]
}

function opensMarkup(text: string, index: number) {
  return text[index] === '`' || OPEN_LINK.test(text.slice(index))
}

function linkPlain(text: string, links: readonly TextLink[]) {
  return links.reduce((linked, { pattern, toLink }) => {
    return linked.replace(pattern, toLink)
  }, text)
}

function wholeMatch(text: string, { pattern }: TextLink) {
  const flags = pattern.flags.replace('g', '')

  return new RegExp(`^(?:${pattern.source})$`, flags).test(text)
}

function linkMarkup(markup: string, links: readonly TextLink[]) {
  const code = INLINE_CODE.exec(markup)?.[1]
  const link = links.find((candidate) => {
    return code !== undefined && wholeMatch(code, candidate)
  })

  return code === undefined || link === undefined ? markup : link.toLink(code)
}

export function linkText(markdown: string, links: readonly TextLink[]) {
  let linked = ''
  let plainStart = 0
  let index = 0

  while (index < markdown.length) {
    const markup = closedMarkupAt(markdown, index)

    if (markup === undefined) {
      index += 1
    } else {
      linked += linkPlain(markdown.slice(plainStart, index), links)
      linked += linkMarkup(markup, links)
      index += markup.length
      plainStart = index
    }
  }

  return linked + linkPlain(markdown.slice(plainStart), links)
}

function openMarkupStart(text: string) {
  let index = 0

  while (index < text.length) {
    const markup = closedMarkupAt(text, index)

    if (markup !== undefined) {
      index += markup.length
    } else if (opensMarkup(text, index)) {
      return index
    } else {
      index += 1
    }
  }

  return text.length
}

export function splitAtSafeSpace(text: string) {
  const closed = text.slice(0, openMarkupStart(text))
  const match = LAST_SPACE.exec(closed)

  if (match === null) {
    return { complete: '', rest: text }
  }

  const end = match.index + 1

  return { complete: text.slice(0, end), rest: text.slice(end) }
}
