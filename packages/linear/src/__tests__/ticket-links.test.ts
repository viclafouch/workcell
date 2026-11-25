import { describe, expect, it } from 'vitest'
import { ticketLinks } from '#/ticket-links.ts'

const PREFIX = 'https://linear.app/acme/issue/'

const LINKS = ticketLinks({ teamKeys: ['ABC', 'XY'], ticketUrlPrefix: PREFIX })

function linkPlain(text: string, links = LINKS) {
  return links.reduce((linked, { pattern, toLink }) => {
    return linked.replace(pattern, toLink)
  }, text)
}

describe('the ticket links', () => {
  it.each([
    {
      name: 'a ticket in prose and in parentheses',
      text: 'ABC-12 et (XY-3).',
      linked: `[ABC-12](${PREFIX}ABC-12) et ([XY-3](${PREFIX}XY-3)).`
    },
    {
      name: 'a word of another team, a version, a longer word or a URL',
      text: 'UTF-8, ZZ-1, ABC-12a, ÉABC-12 et https://x.test/ABC-12',
      linked: 'UTF-8, ZZ-1, ABC-12a, ÉABC-12 et https://x.test/ABC-12'
    }
  ])('links $name only where it names a ticket', ({ text, linked }) => {
    expect(linkPlain(text)).toBe(linked)
  })

  it('links nothing when the workspace has no team', () => {
    const links = ticketLinks({ teamKeys: [], ticketUrlPrefix: PREFIX })

    expect(linkPlain('ABC-12 et -3.', links)).toBe('ABC-12 et -3.')
  })
})
