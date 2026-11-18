import type { CardElement } from 'chat'
import { describe, expect, it } from 'vitest'
import { SENT_FILE_EVENT } from '@workcell/core'
import { CARD_EVENT, cardEventValue } from '#/cards/card-event.ts'
import { postOfEvent } from '#/worker-threads/worker-thread-posts.ts'

const CARD: CardElement = {
  type: 'card',
  title: 'Checks',
  children: [{ type: 'text', content: 'All green' }]
}

const SENT_NOTES = { key: 'sent-files/worker-1/notes', name: 'notes.md' }

function sentFilesHolding(keys: readonly string[]) {
  const held = new Set(keys)

  return {
    take: async (key: string) => {
      const isHeld = held.delete(key)

      return isHeld ? new TextEncoder().encode('# Notes') : null
    }
  }
}

describe('postOfEvent', () => {
  it('posts a card as the worker, and a file as the bot, since a chat uploads a file as the bot only', async () => {
    const sentFiles = sentFilesHolding([SENT_NOTES.key])
    const cardPost = await postOfEvent(
      CARD_EVENT,
      cardEventValue(CARD),
      sentFiles
    )
    const filePost = await postOfEvent(SENT_FILE_EVENT, SENT_NOTES, sentFiles)

    expect(cardPost).toStrictEqual({ message: { card: CARD }, asBot: false })
    expect(filePost).toMatchObject({
      message: { markdown: '', files: [{ filename: 'notes.md' }] },
      asBot: true
    })
  })

  it('posts a sent file once, and nothing for a file the store no longer holds', async () => {
    const sentFiles = sentFilesHolding([SENT_NOTES.key])
    const first = await postOfEvent(SENT_FILE_EVENT, SENT_NOTES, sentFiles)
    const second = await postOfEvent(SENT_FILE_EVENT, SENT_NOTES, sentFiles)

    expect(first).toBeDefined()
    expect(second).toBeUndefined()
  })

  it('posts nothing for another event, a bad value, or with no sent-file store', async () => {
    const sentFiles = sentFilesHolding([SENT_NOTES.key])

    expect(
      await Promise.all([
        postOfEvent('workcell.other', {}, sentFiles),
        postOfEvent(SENT_FILE_EVENT, { name: 'notes.md' }, sentFiles),
        postOfEvent(CARD_EVENT, { card: 'none' }, sentFiles),
        postOfEvent(SENT_FILE_EVENT, SENT_NOTES)
      ])
    ).toStrictEqual([undefined, undefined, undefined, undefined])
  })
})
