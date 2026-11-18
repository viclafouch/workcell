import { describe, expect, it } from 'vitest'
import {
  linkText,
  splitAtSafeSpace,
  type TextLink
} from '#/connection/text-links.ts'

const TASK_LINK: TextLink = {
  pattern: /(?<![\p{L}\p{N}_/-])TASK-\d+(?![\p{L}\p{N}_-])/gu,
  toLink: (ticket) => {
    return `[${ticket}](https://tracker.test/${ticket})`
  }
}

const FENCE = '```'

describe('the text links', () => {
  it.each([
    {
      name: 'a ticket in prose',
      text: 'TASK-7 is done.',
      linked: '[TASK-7](https://tracker.test/TASK-7) is done.'
    },
    {
      name: 'a ticket alone in inline code',
      text: 'See `TASK-7`.',
      linked: 'See [TASK-7](https://tracker.test/TASK-7).'
    },
    {
      name: 'a ticket inside a longer inline code',
      text: 'Run `git checkout TASK-7` now.',
      linked: 'Run `git checkout TASK-7` now.'
    },
    {
      name: 'a ticket inside a code block',
      text: `${FENCE}\ngit log --grep TASK-7\n${FENCE}`,
      linked: `${FENCE}\ngit log --grep TASK-7\n${FENCE}`
    },
    {
      name: 'a ticket inside a link',
      text: '[fix TASK-7 now](https://x.test)',
      linked: '[fix TASK-7 now](https://x.test)'
    }
  ])(
    'links $name only where the reader sees plain text',
    ({ text, linked }) => {
      expect(linkText(text, [TASK_LINK])).toBe(linked)
    }
  )

  it.each([
    {
      name: 'an inline code',
      text: 'Run `git checkout TA',
      complete: 'Run '
    },
    {
      name: 'a code block',
      text: `See ${FENCE}\ngit log TASK-7 and`,
      complete: 'See '
    },
    {
      name: 'a link',
      text: 'Read [the guide of',
      complete: 'Read '
    },
    {
      name: 'nothing',
      text: 'Alpha works on TA',
      complete: 'Alpha works on '
    }
  ])(
    'holds back the text from $name that is still open',
    ({ text, complete }) => {
      expect(splitAtSafeSpace(text)).toStrictEqual({
        complete,
        rest: text.slice(complete.length)
      })
    }
  )
})
