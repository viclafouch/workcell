import type { CardElement } from 'chat'
import { describe, expect, it } from 'vitest'
import { CARD_EVENT, cardEventValue } from '#/cards/card-event.ts'
import { FILE_EVENT, fileEventValue } from '#/files/file-event.ts'
import { postOfEvent } from '#/worker-threads/worker-thread-posts.ts'

const CARD: CardElement = {
  type: 'card',
  title: 'Checks',
  children: [{ type: 'text', content: 'All green' }]
}

describe('postOfEvent', () => {
  it('posts a card as the worker, and a file as the bot, since a chat uploads a file as the bot only', () => {
    const cardPost = postOfEvent(CARD_EVENT, cardEventValue(CARD))
    const filePost = postOfEvent(
      FILE_EVENT,
      fileEventValue({ name: 'notes.md', content: '# Notes' })
    )

    expect(cardPost).toStrictEqual({ message: { card: CARD }, asBot: false })
    expect(filePost).toMatchObject({
      message: { markdown: '', files: [{ filename: 'notes.md' }] },
      asBot: true
    })
  })

  it('posts nothing for another event, or for an event with a bad value', () => {
    expect([
      postOfEvent('workcell.other', {}),
      postOfEvent(FILE_EVENT, { name: 'notes.md' }),
      postOfEvent(CARD_EVENT, { card: 'none' })
    ]).toStrictEqual([undefined, undefined, undefined])
  })
})
