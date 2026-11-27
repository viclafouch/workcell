import { describe, expect, it } from 'vitest'
import { chatInputOf, chatThreadOfMessages } from '../chat-input.ts'

describe('chatInputOf', () => {
  it('reads the chat thread and the input of a message sent from the chat', () => {
    expect(
      chatInputOf('user-chat:acme:C1:1700000000.000100:1700000000.000200')
    ).toStrictEqual({
      inputId: 'chat:acme:C1:1700000000.000100:1700000000.000200',
      threadId: 'acme:C1:1700000000.000100'
    })
  })

  it('reads a message a person sent to a worker from its chat thread', () => {
    expect(
      chatInputOf(
        'user-person:chat:acme:C1:1700000000.000100:1700000000.000300'
      )
    ).toStrictEqual({
      inputId: 'chat:acme:C1:1700000000.000100:1700000000.000300',
      threadId: 'acme:C1:1700000000.000100'
    })
  })

  it('reads nothing from a message that came from no chat', () => {
    expect(chatInputOf('user-ca243cf7-90f9-4269-9e5b-d8bcd721a43e')).toBeNull()
  })
})

describe('chatThreadOfMessages', () => {
  it('finds the chat thread of the first message sent from a chat', () => {
    expect(
      chatThreadOfMessages([
        { id: 'user-task', role: 'user' },
        { id: 'reply', role: 'assistant' },
        {
          id: 'user-person:chat:acme:C1:1700000000.000100:1700000000.000300',
          role: 'user'
        }
      ])
    ).toBe('acme:C1:1700000000.000100')
  })
})
