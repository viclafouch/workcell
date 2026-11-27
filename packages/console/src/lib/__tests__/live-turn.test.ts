import { describe, expect, it } from 'vitest'
import type { ViewMessage } from '@tanstack/ai-harness/view'
import type { ChatThreadDetails } from '#/server/console-context.ts'
import { pendingQuestionOf, withPendingQuestion } from '../live-turn.ts'

const chatMessage = (id: string, sentAt: number, isMe = false) => {
  return {
    inputId: `chat:acme:C1:100.1:${id}`,
    authorId: isMe ? 'bot' : 'person',
    sentAt,
    isMe,
    text: `text of ${id}`
  }
}

const details = (
  messages: ChatThreadDetails['messages']
): ChatThreadDetails => {
  return { place: { isDM: false, isPrivate: false }, people: [], messages }
}

const FIRST_SENT_AT = 1000

const REPLY_SENT_AT = 2000

const NEXT_SENT_AT = 3000

const shownQuestion: ViewMessage = {
  id: 'user-chat:acme:C1:100.1:100.1',
  role: 'user',
  text: 'First question'
}

const liveReply: ViewMessage = {
  id: 'turn-op-2',
  role: 'assistant',
  parts: []
}

describe('pendingQuestionOf', () => {
  it('finds the question of the running turn that the view does not show yet', () => {
    expect(
      pendingQuestionOf({
        messages: [shownQuestion, liveReply],
        details: details([
          chatMessage('100.1', FIRST_SENT_AT),
          chatMessage('100.2', REPLY_SENT_AT, true),
          chatMessage('100.3', NEXT_SENT_AT)
        ]),
        isRunning: false
      })
    ).toStrictEqual({
      id: 'user-chat:acme:C1:100.1:100.3',
      role: 'user',
      text: 'text of 100.3',
      createdAt: NEXT_SENT_AT
    })
  })

  it('finds nothing once the turn is saved, so chatter that never reached the bot stays out', () => {
    expect(
      pendingQuestionOf({
        messages: [shownQuestion],
        details: details([
          chatMessage('100.1', FIRST_SENT_AT),
          chatMessage('100.3', NEXT_SENT_AT)
        ]),
        isRunning: false
      })
    ).toBeNull()
  })

  it('reads a question a person sent to a worker as shown', () => {
    expect(
      pendingQuestionOf({
        messages: [
          {
            id: 'user-person:chat:acme:C1:100.1:100.3',
            role: 'user',
            text: 'Stop.'
          },
          liveReply
        ],
        details: details([chatMessage('100.3', NEXT_SENT_AT)]),
        isRunning: false
      })
    ).toBeNull()
  })

  it('finds the question as soon as its turn runs, before any reply streams', () => {
    expect(
      pendingQuestionOf({
        messages: [shownQuestion],
        details: details([
          chatMessage('100.1', FIRST_SENT_AT),
          chatMessage('100.3', NEXT_SENT_AT)
        ]),
        isRunning: true
      })?.id
    ).toBe('user-chat:acme:C1:100.1:100.3')
  })

  it('finds nothing once the view shows the last question', () => {
    expect(
      pendingQuestionOf({
        messages: [shownQuestion],
        details: details([
          chatMessage('100.1', FIRST_SENT_AT),
          chatMessage('100.2', REPLY_SENT_AT, true)
        ]),
        isRunning: false
      })
    ).toBeNull()
  })
})

describe('withPendingQuestion', () => {
  it('puts the question before the reply that streams', () => {
    const question = { ...shownQuestion, id: 'user-next' }

    expect(
      withPendingQuestion([shownQuestion, liveReply], question).map(
        ({ id }) => {
          return id
        }
      )
    ).toStrictEqual([shownQuestion.id, 'user-next', 'turn-op-2'])
  })
})
