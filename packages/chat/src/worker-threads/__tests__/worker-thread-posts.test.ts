import type { CardElement } from 'chat'
import { describe, expect, it } from 'vitest'
import { SENT_FILE_EVENT } from '@workcell/core'
import { CARD_EVENT, cardEventValue } from '#/cards/card-event.ts'
import { messageOfEvent } from '#/worker-threads/worker-thread-posts.ts'

const CARD: CardElement = {
  type: 'card',
  title: 'Checks',
  children: [{ type: 'text', content: 'All green' }]
}

const SENT_NOTES = { key: 'sent-files/worker-1/notes', name: 'notes.md' }

const SENT_FILES = {
  take: async (key: string) => {
    return key === SENT_NOTES.key ? new TextEncoder().encode('# Notes') : null
  }
}

describe('messageOfEvent', () => {
  it('turns a card event into a card, and a sent-file event into its file', async () => {
    const cardPost = await messageOfEvent(
      CARD_EVENT,
      cardEventValue(CARD),
      SENT_FILES
    )
    const filePost = await messageOfEvent(
      SENT_FILE_EVENT,
      SENT_NOTES,
      SENT_FILES
    )

    expect(cardPost).toStrictEqual({ card: CARD })
    expect(filePost).toMatchObject({
      markdown: '',
      files: [{ filename: 'notes.md' }]
    })
  })

  it('posts nothing for another event or a bad value', async () => {
    expect(
      await Promise.all([
        messageOfEvent('workcell.other', {}, SENT_FILES),
        messageOfEvent(SENT_FILE_EVENT, { name: 'notes.md' }, SENT_FILES),
        messageOfEvent(CARD_EVENT, { card: 'none' }, SENT_FILES)
      ])
    ).toStrictEqual([undefined, undefined, undefined])
  })
})
