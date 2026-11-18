import { describe, expect, it } from 'vitest'
import { ticketLinks } from '#/ticket-links.ts'

const PREFIX = 'https://linear.app/acme/issue/'

const LINKS = ticketLinks({ teamKeys: ['ABC', 'XY'], ticketUrlPrefix: PREFIX })

function linkText(text: string) {
  return LINKS.reduce((linked, { pattern, toLink }) => {
    return linked.replace(pattern, toLink)
  }, text)
}

describe('the ticket links', () => {
  it.each([
    {
      name: 'a ticket in prose',
      text: 'ABC-12 est en Todo.',
      linked: `[ABC-12](${PREFIX}ABC-12) est en Todo.`
    },
    {
      name: 'a ticket in parentheses and in code',
      text: '(XY-3) et `ABC-4`',
      linked: `([XY-3](${PREFIX}XY-3)) et [ABC-4](${PREFIX}ABC-4)`
    },
    {
      name: 'a ticket already in a link',
      text: `[ABC-12](${PREFIX}ABC-12)`,
      linked: `[ABC-12](${PREFIX}ABC-12)`
    },
    {
      name: 'a word of another team or no ticket',
      text: 'UTF-8, ZZ-1 et ABC-12a',
      linked: 'UTF-8, ZZ-1 et ABC-12a'
    }
  ])('links $name only where it names a ticket', ({ text, linked }) => {
    expect(linkText(text)).toBe(linked)
  })

  it('gives no rule when the workspace has no team', () => {
    expect(
      ticketLinks({ teamKeys: [], ticketUrlPrefix: PREFIX })
    ).toStrictEqual([])
  })
})
