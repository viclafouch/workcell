import type { CardElement } from 'chat'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { EventType, type StreamChunk } from '@tanstack/ai'
import {
  BUDGET_END_EVENT,
  type AskOrchestratorParams,
  type Orchestrator
} from '@workcell/core'
import {
  BOT_USER,
  openSlackChat,
  SILENT_CHAT_LOGGER,
  slackSessionStatus,
  TEAM,
  useSlackApi,
  type SlackCall
} from '#/__tests__/test-doubles.ts'
import { CARD_EVENT, cardEventValue } from '#/cards/card-event.ts'
import { openChatConnection } from '#/connection/chat-connection.ts'
import { createChatSurface } from '#/connection/chat-surface.ts'
import type { TextLink } from '#/connection/text-links.ts'
import {
  createOrchestratorThreads,
  isOrchestratorThreadIn
} from '#/orchestrator-threads/orchestrator-threads.ts'
import { CHAT_LINES, type ChatLines } from '#/prompts/chat.ts'

const STARTER = 'U_STARTER'

const COLLEAGUE = 'U_COLLEAGUE'

const TEST_CHANNEL = 'C_TEST'

const TEAM_CHANNEL = 'C_TEAM'

const TEST_THREAD = `slack:${TEST_CHANNEL}:100.0001`

const LAST_TWO_CALLS = 2

const LAST_THREE_CALLS = 3

const slackApi = useSlackApi()

type Answer = Awaited<ReturnType<Orchestrator['ask']>>

function answered(fields: Partial<Answer> = {}): Answer {
  return {
    ownsTurn: true,
    outcome: 'completed',
    error: undefined,
    waits: [],
    ...fields
  }
}

const TASK_LINK: TextLink = {
  pattern: /TASK-\d+/gu,
  toLink: (match) => {
    return `[${match}](https://tracker.test/${match})`
  }
}

const LIST_WORKERS_TURN: StreamChunk[] = [
  {
    type: EventType.TOOL_CALL_START,
    toolCallId: 'call-1',
    toolCallName: 'list_workers'
  },
  { type: EventType.TOOL_CALL_END, toolCallId: 'call-1', input: {} },
  {
    type: EventType.TOOL_CALL_RESULT,
    toolCallId: 'call-1',
    messageId: 'message-1',
    content: '[{"name":"Alpha"}]'
  },
  {
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId: 'message-2',
    delta: 'Alpha works '
  },
  {
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId: 'message-2',
    delta: 'on TASK-7.'
  }
]

const ANSWER_EVENTS = LIST_WORKERS_TURN.filter(({ type }) => {
  return type === EventType.TEXT_MESSAGE_CONTENT
})

const streamChunksSchema = z.array(
  z.looseObject({
    type: z.string(),
    text: z.string().optional(),
    id: z.string().optional(),
    title: z.string().optional(),
    status: z.string().optional(),
    details: z.string().optional()
  })
)

function chunkLines(body: Record<string, string>) {
  const chunks = streamChunksSchema.parse(JSON.parse(body.chunks ?? '[]'))

  return chunks.map(({ type, text, id, title, status, details }) => {
    return type === 'markdown_text'
      ? `text ${text}`
      : [type === 'task_update' ? 'task' : type, id, title, status, details]
          .filter(Boolean)
          .join(' ')
  })
}

function callLines({ method, body }: SlackCall) {
  if (method === 'agents.sessions.setStatus') {
    return [`status ${body.thread_ts} ${body.status}`]
  }

  if (method === 'chat.startStream') {
    return [
      `stream ${body.thread_ts} to ${body.recipient_user_id} of ${body.recipient_team_id}`,
      ...chunkLines(body)
    ]
  }

  if (method === 'chat.appendStream') {
    return chunkLines(body)
  }

  if (method === 'chat.stopStream') {
    return [...chunkLines(body), `stop ${body.session_status}`]
  }

  if (method === 'chat.postMessage') {
    return [`post ${body.thread_ts}: ${body.markdown_text ?? body.text}`]
  }

  return [`${method} ${body.thread_ts}`]
}

const TEXT_LINE = 'text '

function sent() {
  const lines: string[] = []

  for (const line of slackApi.calls.flatMap(callLines)) {
    const last = lines.at(-1)

    if (line.startsWith(TEXT_LINE) && last?.startsWith(TEXT_LINE)) {
      lines.splice(-1, 1, `${last}${line.slice(TEXT_LINE.length)}`)
    } else {
      lines.push(line)
    }
  }

  return lines
}

type FakeOrchestratorParams = {
  events?: StreamChunk[]
  answer?: Answer | Error
  heldThreads?: string[]
  isRunning?: boolean
}

function fakeOrchestrator({
  events = [],
  answer = answered(),
  heldThreads = [],
  isRunning = true
}: FakeOrchestratorParams = {}) {
  const asked: Omit<AskOrchestratorParams, 'onEvent'>[] = []
  const stops: string[] = []
  let holdsReads = 0
  const orchestrator: Pick<Orchestrator, 'ask' | 'stop' | 'holds'> = {
    ask: async ({ onEvent, ...message }) => {
      asked.push(message)

      for (const event of events) {
        // oxlint-disable-next-line no-await-in-loop -- the events of a turn reach the thread in order
        await onEvent(event)
      }

      if (Error.isError(answer)) {
        throw answer
      }

      return answer
    },
    stop: async ({ threadId, user }) => {
      stops.push(`${threadId} ${user.id}`)

      return isRunning
    },
    holds: async (threadId) => {
      holdsReads += 1

      return heldThreads.includes(threadId)
    }
  }

  return {
    orchestrator,
    asked,
    stops,
    holdsReads: () => {
      return holdsReads
    }
  }
}

async function openOrchestratorChat(
  orchestrator: Pick<Orchestrator, 'ask' | 'stop' | 'holds'>,
  lines?: ChatLines,
  links?: readonly TextLink[]
) {
  const slackChat = openSlackChat()
  const threads = createOrchestratorThreads({
    surface: createChatSurface({
      chat: slackChat.chat,
      extras: slackSessionStatus(slackChat.slack),
      links
    }),
    orchestrator,
    allowedStarters: [STARTER],
    allowedChannels: [`slack:${TEAM_CHANNEL}`],
    logger: SILENT_CHAT_LOGGER,
    lines
  })
  const connection = await openChatConnection({
    chat: slackChat.chat,
    orchestrator: threads,
    logger: SILENT_CHAT_LOGGER,
    lines
  })

  return {
    ...slackChat,
    threads,
    ask: (text: string, fields: Record<string, string> = {}) => {
      return slackChat.deliverEvent({
        type: 'app_mention',
        user: STARTER,
        channel: TEST_CHANNEL,
        ts: '100.0001',
        text: `<@${BOT_USER}> ${text}`,
        ...fields
      })
    },
    reply: (fields: Record<string, string>) => {
      return slackChat.deliverEvent({
        type: 'message',
        channel_type: 'channel',
        user: STARTER,
        channel: TEST_CHANNEL,
        thread_ts: '100.0001',
        text: 'And then?',
        ...fields
      })
    },
    [Symbol.asyncDispose]: () => {
      return connection[Symbol.asyncDispose]()
    }
  }
}

describe('an orchestrator thread', () => {
  it('streams its answer into the thread, with a task card for each tool call that sends its details once', async () => {
    const fake = fakeOrchestrator({ events: LIST_WORKERS_TURN })
    await using chat = await openOrchestratorChat(fake.orchestrator)

    await chat.ask('What runs?')

    expect(fake.asked).toStrictEqual([
      {
        threadId: TEST_THREAD,
        user: { id: STARTER },
        inputId: `chat:${TEST_THREAD}:100.0001`,
        message: `@${BOT_USER} What runs?`
      }
    ])
    expect(sent()).toStrictEqual([
      'status 100.0001 processing',
      `stream 100.0001 to ${STARTER} of ${TEAM}`,
      'task call-1 list_workers in_progress',
      'task call-1 list_workers in_progress {}',
      'task call-1 list_workers complete',
      'text Alpha works on TASK-7.',
      'stop active'
    ])
  })

  it('links each text that a link rule names, also when the stream splits it', async () => {
    const fake = fakeOrchestrator({
      events: [
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'message-1',
          delta: 'Alpha works on TA'
        },
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'message-1',
          delta: 'SK-7 now.'
        }
      ]
    })
    await using chat = await openOrchestratorChat(
      fake.orchestrator,
      undefined,
      [TASK_LINK]
    )

    await chat.ask('What runs?')

    expect(sent()).toContain(
      'text Alpha works on [TASK-7](https://tracker.test/TASK-7) now.'
    )
  })

  it('starts each text message of a turn on its own paragraph', async () => {
    const fake = fakeOrchestrator({
      events: [
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'message-1',
          delta: 'I check the ticket.'
        },
        ...LIST_WORKERS_TURN
      ]
    })
    await using chat = await openOrchestratorChat(fake.orchestrator)

    await chat.ask('What runs?')

    expect(sent()).toContain(
      'text I check the ticket.\n\nAlpha works on TASK-7.'
    )
  })

  it('marks the task card of a tool call that TanStack ends in error, whatever its content', async () => {
    const fake = fakeOrchestrator({
      events: [
        {
          type: EventType.TOOL_CALL_START,
          toolCallId: 'call-1',
          toolCallName: 'stop_worker'
        },
        {
          type: EventType.TOOL_CALL_RESULT,
          toolCallId: 'call-1',
          messageId: 'message-1',
          content: 'No live worker is named Bravo.',
          metadata: { tanstack: { state: 'output-error' } }
        },
        {
          type: EventType.TOOL_CALL_START,
          toolCallId: 'call-2',
          toolCallName: 'list_workers'
        },
        {
          type: EventType.TOOL_CALL_RESULT,
          toolCallId: 'call-2',
          messageId: 'message-1',
          content: '{"error":"a field of the answer"}'
        }
      ]
    })
    await using chat = await openOrchestratorChat(fake.orchestrator)

    await chat.ask('Stop Bravo.')

    expect(sent()).toContain('task call-1 stop_worker error')
    expect(sent()).toContain('task call-2 list_workers complete')
  })

  it('answers a colleague in an allowed channel, an allowed starter anywhere, and nobody else', async () => {
    const fake = fakeOrchestrator()
    await using chat = await openOrchestratorChat(fake.orchestrator)

    await chat.ask('What runs?', { user: COLLEAGUE, ts: '1.0001' })
    await chat.ask('What runs?', {
      user: COLLEAGUE,
      channel: TEAM_CHANNEL,
      ts: '2.0001'
    })
    await chat.ask('What runs?', { channel: 'C_OTHER', ts: '3.0001' })

    expect(
      fake.asked.map(({ user, inputId }) => {
        return `${user.id} ${inputId}`
      })
    ).toStrictEqual([
      `${COLLEAGUE} chat:slack:${TEAM_CHANNEL}:2.0001:2.0001`,
      `${STARTER} chat:slack:C_OTHER:3.0001:3.0001`
    ])
  })

  it('leaves the stream alone for a message that joins the running turn as a steer', async () => {
    const fake = fakeOrchestrator({ answer: answered({ ownsTurn: false }) })
    await using chat = await openOrchestratorChat(fake.orchestrator)

    await chat.ask('And the logout?')

    expect(fake.asked).toHaveLength(1)
    expect(sent()).toStrictEqual(['status 100.0001 processing'])
  })

  it('posts the cards of a turn after its answer, in order', async () => {
    const tableCard: CardElement = {
      type: 'card',
      title: 'Workers',
      children: [{ type: 'text', content: 'Alpha on TASK-7' }]
    }
    const chartCard: CardElement = {
      type: 'card',
      title: 'Cost',
      children: [{ type: 'text', content: '$5.00' }]
    }
    const fake = fakeOrchestrator({
      events: [
        {
          type: EventType.CUSTOM,
          name: CARD_EVENT,
          value: cardEventValue(tableCard)
        },
        { type: EventType.CUSTOM, name: CARD_EVENT, value: { card: 'none' } },
        ...ANSWER_EVENTS,
        {
          type: EventType.CUSTOM,
          name: CARD_EVENT,
          value: cardEventValue(chartCard)
        }
      ]
    })
    await using chat = await openOrchestratorChat(fake.orchestrator)

    await chat.ask('Who works on what?')
    const cardPosts = slackApi.writes('chat.postMessage')

    expect(sent().slice(-LAST_THREE_CALLS)).toStrictEqual([
      'stop active',
      expect.stringContaining('post 100.0001: '),
      expect.stringContaining('post 100.0001: ')
    ])
    expect(
      cardPosts.map(({ body }) => {
        return body.blocks
      })
    ).toStrictEqual([
      expect.stringContaining('Alpha on TASK-7'),
      expect.stringContaining('$5.00')
    ])
  })
})

describe('the end of an orchestrator turn', () => {
  it('ends a stopped turn with one line, and a turn that waits with its question and the suspended status', async () => {
    const stopped = fakeOrchestrator({
      events: LIST_WORKERS_TURN.slice(0, 1),
      answer: answered({ outcome: 'aborted' })
    })
    const waiting = fakeOrchestrator({
      answer: answered({
        outcome: 'interrupted',
        waits: ['The orchestrator used its budget.']
      })
    })
    await using stoppedChat = await openOrchestratorChat(stopped.orchestrator)
    await stoppedChat.ask('What runs?')
    const stoppedCalls = sent()
    slackApi.calls.length = 0
    await using waitingChat = await openOrchestratorChat(waiting.orchestrator)
    await waitingChat.ask('What runs?')

    expect(stoppedCalls.slice(-LAST_TWO_CALLS)).toStrictEqual([
      'text Stopped.',
      'stop active'
    ])
    expect(sent().slice(-LAST_THREE_CALLS)).toStrictEqual([
      'text The orchestrator used its budget.',
      'stop active',
      'status 100.0001 suspended'
    ])
  })

  it('ends a stopped turn and a failed turn with the lines of the project', async () => {
    const lines = {
      ...CHAT_LINES,
      stoppedTurn: 'Halted.',
      failedTurn: 'Broken.'
    }
    const stopped = fakeOrchestrator({
      events: LIST_WORKERS_TURN.slice(-1),
      answer: answered({ outcome: 'aborted' })
    })
    const failed = fakeOrchestrator({
      answer: answered({
        outcome: 'failed',
        error: 'The model gateway answered 502.'
      })
    })
    await using stoppedChat = await openOrchestratorChat(
      stopped.orchestrator,
      lines
    )
    await stoppedChat.ask('What runs?')
    const stoppedCalls = sent()
    slackApi.calls.length = 0
    await using failedChat = await openOrchestratorChat(
      failed.orchestrator,
      lines
    )
    await failedChat.ask('What runs?')

    expect(stoppedCalls.slice(-LAST_TWO_CALLS)).toStrictEqual([
      'text on TASK-7.\n\nHalted.',
      'stop active'
    ])
    expect(sent().slice(-LAST_TWO_CALLS)).toStrictEqual([
      'text Broken.',
      'stop active'
    ])
  })

  it('ends a turn that its budget stopped with the budget line only', async () => {
    const budgetEnd: StreamChunk = {
      type: EventType.CUSTOM,
      name: BUDGET_END_EVENT,
      value: { reason: 'budget', message: 'The orchestrator used its budget.' }
    }
    const fake = fakeOrchestrator({
      events: [...LIST_WORKERS_TURN.slice(-1), budgetEnd],
      answer: answered({ outcome: 'aborted' })
    })
    await using chat = await openOrchestratorChat(fake.orchestrator)

    await chat.ask('What runs?')

    expect(sent().slice(-LAST_TWO_CALLS)).toStrictEqual([
      'text on TASK-7.\n\nThe orchestrator used its budget.',
      'stop active'
    ])
  })

  it('posts the whole answer when the stream breaks', async () => {
    slackApi.answer('chat.stopStream', { ok: false, error: 'internal_error' })
    const fake = fakeOrchestrator({ events: LIST_WORKERS_TURN })
    await using chat = await openOrchestratorChat(fake.orchestrator)

    await chat.ask('What runs?')

    expect(sent().slice(-LAST_TWO_CALLS)).toStrictEqual([
      'status 100.0001 active',
      'post 100.0001: Alpha works on TASK-7.'
    ])
  })

  it('leaves the processing status of a turn that streamed nothing', async () => {
    const fake = fakeOrchestrator()
    await using chat = await openOrchestratorChat(fake.orchestrator)

    await chat.ask('Anything?')

    expect(sent()).toStrictEqual([
      'status 100.0001 processing',
      'status 100.0001 active'
    ])
  })

  it('tells the thread when its turn fails, then leaves the processing status', async () => {
    const fake = fakeOrchestrator({
      answer: new Error('The model gateway answered 502.')
    })
    await using chat = await openOrchestratorChat(fake.orchestrator)

    await chat.ask('What runs?')

    expect(sent()).toContain(
      'post 100.0001: An error stopped me. The host logs say which one.'
    )
    expect(sent().at(-1)).toBe('status 100.0001 active')
  })
})

describe('the replies and the stops of an orchestrator thread', () => {
  it('answers a reply only in a thread it holds, and reads the store once per thread', async () => {
    const fake = fakeOrchestrator({ heldThreads: [TEST_THREAD] })
    await using chat = await openOrchestratorChat(fake.orchestrator)
    await chat.chat.thread(TEST_THREAD).subscribe()
    await chat.chat.thread(`slack:${TEST_CHANNEL}:200.0001`).subscribe()

    await chat.reply({ ts: '100.0002', text: 'And then?' })
    await chat.reply({ ts: '100.0003', text: 'And after?' })
    await chat.reply({ thread_ts: '200.0001', ts: '200.0002' })
    await chat.reply({ user: COLLEAGUE, ts: '100.0004' })

    expect(
      fake.asked.map(({ message }) => {
        return message
      })
    ).toStrictEqual(['And then?', 'And after?'])
    expect(fake.holdsReads()).toBe(2)
  })

  it('answers the replies of the thread it opened on a mention without reading the store', async () => {
    const fake = fakeOrchestrator()
    await using chat = await openOrchestratorChat(fake.orchestrator)

    await chat.ask('What runs?')
    await chat.reply({ ts: '100.0002', text: 'And then?' })

    expect(fake.asked).toHaveLength(2)
    expect(fake.holdsReads()).toBe(0)
  })

  it('stops its turn on the stop of an allowed person, and leaves the status when nothing runs', async () => {
    const running = fakeOrchestrator()
    const idle = fakeOrchestrator({ isRunning: false })
    await using runningChat = await openOrchestratorChat(running.orchestrator)
    await using idleChat = await openOrchestratorChat(idle.orchestrator)

    await runningChat.threads.stop(TEST_THREAD, COLLEAGUE)
    await runningChat.threads.stop(TEST_THREAD, STARTER)
    const runningCalls = sent()
    await idleChat.threads.stop(TEST_THREAD, STARTER)

    expect(running.stops).toStrictEqual([`${TEST_THREAD} ${STARTER}`])
    expect(runningCalls).toStrictEqual([])
    expect(sent()).toStrictEqual(['status 100.0001 active'])
  })

  it('stops its turn when a person stops the agent session', async () => {
    const fake = fakeOrchestrator()
    await using chat = await openOrchestratorChat(fake.orchestrator)

    await chat.deliverEvent({
      type: 'agent_session_stopped',
      channel: TEST_CHANNEL,
      user: STARTER,
      thread_ts: '100.0001',
      streaming_message_ts: [],
      event_ts: '100.0009'
    })

    expect(fake.stops).toStrictEqual([`${TEST_THREAD} ${STARTER}`])
  })
})

describe('the orchestrator threads of the allowed channels', () => {
  it('holds a thread of an allowed channel, and no thread of another channel or of a worker', async () => {
    await using slackChat = openSlackChat()
    const isAllowedThread = isOrchestratorThreadIn(slackChat.chat, [
      `slack:${TEAM_CHANNEL}`
    ])

    expect(isAllowedThread('slack:C_TEAM:1.0001')).toBe(true)
    expect(isAllowedThread('slack:C_TEAMS:1.0001')).toBe(false)
    expect(isAllowedThread('slack:C_TEST:1.0001')).toBe(false)
    expect(isAllowedThread('9fe236f0-b749-4156-83be-6bb5ec7d0ea9')).toBe(false)
  })
})
