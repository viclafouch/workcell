import { describe, expect, it } from 'vitest'
import type { ViewMessage } from '@tanstack/ai-harness/view'
import { groupChatTurns, splitAgentWork } from '../chat-turns.ts'

const person = (id: string): ViewMessage => {
  return { id, role: 'user', text: id }
}

const agent = (
  id: string,
  parts: Extract<ViewMessage, { role: 'assistant' }>['parts']
): ViewMessage => {
  return { id, role: 'assistant', parts }
}

const toolCall = (id: string) => {
  return {
    type: 'tool-call' as const,
    id,
    name: 'grep',
    argsText: '{}',
    args: {},
    status: 'done' as const
  }
}

describe('groupChatTurns', () => {
  it('gathers the messages an agent writes in a row into one turn', () => {
    const turns = groupChatTurns([
      person('question'),
      agent('first-call', [toolCall('a')]),
      agent('second-call', [{ type: 'text', text: 'Done.' }]),
      person('follow-up')
    ])

    expect(turns).toMatchObject([
      { kind: 'person', id: 'question' },
      {
        kind: 'agent',
        messages: [{ id: 'first-call' }, { id: 'second-call' }]
      },
      { kind: 'person', id: 'follow-up' }
    ])
  })
})

describe('the id of an agent turn', () => {
  it('stays the same whether the turn streams as one message or reloads as many', () => {
    const live = groupChatTurns([
      {
        id: 'turn-op-1',
        role: 'assistant',
        operationId: 'op-1',
        parts: [toolCall('a'), { type: 'text', text: 'Done.' }]
      }
    ])
    const saved = groupChatTurns([
      person('question'),
      {
        id: 'call-1',
        role: 'assistant',
        operationId: 'op-1',
        parts: [toolCall('a')]
      },
      {
        id: 'call-2',
        role: 'assistant',
        operationId: 'op-1',
        parts: [{ type: 'text', text: 'Done.' }]
      }
    ])

    expect(live[0]?.id).toBe(saved[1]?.id)
  })

  it('starts a new turn for each operation, even with no message between them', () => {
    const turns = groupChatTurns([
      { id: 'a', role: 'assistant', operationId: 'op-1', parts: [] },
      { id: 'b', role: 'assistant', operationId: 'op-2', parts: [] }
    ])

    expect(
      turns.map(({ id }) => {
        return id
      })
    ).toStrictEqual(['turn:op-1', 'turn:op-2'])
  })
})

describe('a turn whose messages did not change', () => {
  it('stays the same object, so its row does not render again', () => {
    const question = person('question')
    const reply = agent('reply', [{ type: 'text', text: 'Done.' }])
    const first = groupChatTurns([question, reply])
    const second = groupChatTurns([question, reply, person('next')])

    expect(second[0]).toBe(first[0])
    expect(second[1]).toBe(first[1])
  })
})

describe('splitAgentWork', () => {
  it('keeps the text after the last step as the answer, and the rest as work', () => {
    const { work, answer } = splitAgentWork([
      {
        id: 'call',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'Look first.' },
          { type: 'text', text: 'Searching.' },
          toolCall('a')
        ]
      },
      {
        id: 'reply',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Here it is.' }]
      }
    ])

    expect(
      work.map(({ type }) => {
        return type
      })
    ).toStrictEqual(['reasoning', 'text', 'tool-call'])
    expect(answer).toStrictEqual([{ type: 'text', text: 'Here it is.' }])
  })

  it('shows a turn with no step as an answer alone', () => {
    const { work, answer } = splitAgentWork([
      { id: 'reply', role: 'assistant', parts: [{ type: 'text', text: 'Hi.' }] }
    ])

    expect(work).toStrictEqual([])
    expect(answer).toStrictEqual([{ type: 'text', text: 'Hi.' }])
  })
})
