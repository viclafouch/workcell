import { describe, expect, it } from 'vitest'
import { EventType, type StreamChunk } from '@tanstack/ai'
import {
  BUDGET_END_EVENT,
  type AskOrchestratorParams,
  type Orchestrator
} from '@workcell/core'
import type { SlackPostParams } from './channel-poster.ts'
import {
  createOrchestratorThreads,
  isOrchestratorThreadIn
} from './orchestrator-threads.ts'
import { SLACK_LINES, type SlackLines } from './prompts/slack.ts'
import type { SlackPrompt } from './slack-connection.ts'
import type { SlackWeb } from './slack-web.ts'
import { SILENT_SLACK_LOGGER } from './test-doubles.ts'

const STARTER = 'U_STARTER'

const COLLEAGUE = 'U_COLLEAGUE'

const TEST_CHANNEL = 'C_TEST'

const TEAM_CHANNEL = 'C_TEAM'

const LAST_TWO_CALLS = 2

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

function prompt(fields: Partial<SlackPrompt> = {}): SlackPrompt {
  return {
    channel: TEST_CHANNEL,
    threadTs: '100.0001',
    user: STARTER,
    team: 'T_TEAM',
    ts: '100.0001',
    text: 'What runs?',
    ...fields
  }
}

function describePost({ threadTs, ...content }: SlackPostParams) {
  return `post ${threadTs}: ${'markdown' in content ? content.markdown : content.text}`
}

type RecordSlackParams = { failStreamAt?: number; failRename?: boolean }

function recordSlack({
  failStreamAt,
  failRename = false
}: RecordSlackParams = {}) {
  const calls: string[] = []
  let streamCalls = 0

  const streamCall = (line: string) => {
    streamCalls += 1

    if (streamCalls === failStreamAt) {
      throw new Error('message_not_in_streaming_state')
    }

    calls.push(line)
  }

  const web: SlackWeb = {
    post: async (post) => {
      calls.push(describePost(post))

      return '1.0001'
    },
    edit: async () => {},
    setStatus: async ({ threadTs, status }) => {
      calls.push(`status ${threadTs} ${status}`)
    },
    rename: async ({ threadTs, title }) => {
      if (failRename) {
        throw new Error('feature_disabled')
      }

      calls.push(`rename ${threadTs} ${title}`)
    },
    stream: ({ threadTs, identity, recipient }) => {
      calls.push(
        `stream ${threadTs} as ${identity?.username ?? 'the app'} to ${recipient.user} of ${recipient.team}`
      )

      return {
        appendText: async (markdown) => {
          streamCall(`text ${JSON.stringify(markdown)}`)
        },
        updateTask: async ({ id, title, status, details }) => {
          streamCall(
            ['task', id, title, status, details].filter(Boolean).join(' ')
          )
        },
        stop: async (status) => {
          streamCall(`stop ${status}`)
        }
      }
    }
  }

  return { calls, web }
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

function openOrchestrator(
  web: SlackWeb,
  orchestrator: Pick<Orchestrator, 'ask' | 'stop' | 'holds'>,
  lines?: SlackLines
) {
  return createOrchestratorThreads({
    web,
    orchestrator,
    allowedStarters: [STARTER],
    allowedChannels: [TEAM_CHANNEL],
    logger: SILENT_SLACK_LOGGER,
    lines
  })
}

describe('an orchestrator thread', () => {
  it('streams its answer into the thread, with a task card for each tool call', async () => {
    const { calls, web } = recordSlack()
    const fake = fakeOrchestrator({ events: LIST_WORKERS_TURN })

    await openOrchestrator(web, fake.orchestrator).ask(prompt())

    expect(fake.asked).toStrictEqual([
      {
        threadId: `slack/${TEST_CHANNEL}/100.0001`,
        user: { id: STARTER },
        inputId: `slack:${TEST_CHANNEL}:100.0001`,
        message: 'What runs?'
      }
    ])
    expect(calls).toStrictEqual([
      `stream 100.0001 as the app to ${STARTER} of T_TEAM`,
      'status 100.0001 processing',
      'rename 100.0001 What runs?',
      'task call-1 list_workers in_progress',
      'task call-1 list_workers in_progress {}',
      'task call-1 list_workers complete {}',
      'text "Alpha works "',
      'text "on TASK-7."',
      'stop active'
    ])
  })

  it('marks the task card of a tool call that TanStack ends in error, whatever its content', async () => {
    const { calls, web } = recordSlack()
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

    await openOrchestrator(web, fake.orchestrator).ask(prompt())

    expect(calls).toContain('task call-1 stop_worker error')
    expect(calls).toContain('task call-2 list_workers complete')
  })

  it('answers a colleague in an allowed channel, an allowed starter anywhere, and nobody else', async () => {
    const { web } = recordSlack()
    const fake = fakeOrchestrator()
    const threads = openOrchestrator(web, fake.orchestrator)

    await threads.ask(prompt({ user: COLLEAGUE, ts: '1.0001' }))
    await threads.ask(
      prompt({ user: COLLEAGUE, channel: TEAM_CHANNEL, ts: '2.0001' })
    )
    await threads.ask(prompt({ channel: 'C_OTHER', ts: '3.0001' }))

    expect(
      fake.asked.map(({ user, inputId }) => {
        return `${user.id} ${inputId}`
      })
    ).toStrictEqual([
      `${COLLEAGUE} slack:${TEAM_CHANNEL}:2.0001`,
      `${STARTER} slack:C_OTHER:3.0001`
    ])
  })

  it('leaves the stream alone for a reply that joins the running turn as a steer', async () => {
    const { calls, web } = recordSlack()
    const fake = fakeOrchestrator({
      answer: answered({ ownsTurn: false }),
      heldThreads: [`slack/${TEST_CHANNEL}/100.0001`]
    })

    await openOrchestrator(web, fake.orchestrator).ask(
      prompt({ ts: '100.0002' })
    )

    expect(calls).toStrictEqual([
      `stream 100.0001 as the app to ${STARTER} of T_TEAM`,
      'status 100.0001 processing'
    ])
  })

  it('titles a new thread with the first line of its first message, once', async () => {
    const { calls, web } = recordSlack()
    const fake = fakeOrchestrator({
      heldThreads: [`slack/${TEST_CHANNEL}/200.0001`]
    })
    const threads = openOrchestrator(web, fake.orchestrator)

    await threads.ask(
      prompt({ text: '  where is the login handled?\nin the app' })
    )
    await threads.ask(prompt({ ts: '100.0002', text: 'and the logout?' }))
    await threads.ask(prompt({ threadTs: '200.0001', ts: '200.0002' }))
    await threads.ask(
      prompt({ threadTs: '300.0001', ts: '300.0001', text: ' ' })
    )
    await threads.ask(
      prompt({
        threadTs: '400.0001',
        ts: '400.0001',
        text: 'look at <https://tracker.example.com/TASK-7|TASK-7> on <https://example.com>'
      })
    )

    expect(
      calls.filter((call) => {
        return call.startsWith('rename')
      })
    ).toStrictEqual([
      'rename 100.0001 where is the login handled?',
      'rename 400.0001 look at TASK-7 on https://example.com'
    ])
  })

  it('answers a new thread whose title fails', async () => {
    const { calls, web } = recordSlack({ failRename: true })
    const fake = fakeOrchestrator({ events: LIST_WORKERS_TURN })

    await openOrchestrator(web, fake.orchestrator).ask(prompt())

    expect(fake.asked).toHaveLength(1)
    expect(calls.at(-1)).toBe('stop active')
  })
})

describe('the end of an orchestrator turn', () => {
  it('ends a stopped turn with one line, and a turn that waits with its question', async () => {
    const stopped = recordSlack()
    const waiting = recordSlack()

    await openOrchestrator(
      stopped.web,
      fakeOrchestrator({
        events: LIST_WORKERS_TURN.slice(0, 1),
        answer: answered({ outcome: 'aborted' })
      }).orchestrator
    ).ask(prompt())
    await openOrchestrator(
      waiting.web,
      fakeOrchestrator({
        answer: answered({
          outcome: 'interrupted',
          waits: ['The orchestrator used its budget.']
        })
      }).orchestrator
    ).ask(prompt())

    expect(stopped.calls.slice(-LAST_TWO_CALLS)).toStrictEqual([
      'text "\\n\\nStopped."',
      'stop active'
    ])
    expect(waiting.calls.slice(-LAST_TWO_CALLS)).toStrictEqual([
      'text "\\n\\nThe orchestrator used its budget."',
      'stop suspended'
    ])
  })

  it('ends a stopped turn and a failed turn with the lines of the project', async () => {
    const stopped = recordSlack()
    const failed = recordSlack()
    const lines = {
      ...SLACK_LINES,
      stoppedTurn: 'Halted.',
      failedTurn: 'Broken.'
    }

    await openOrchestrator(
      stopped.web,
      fakeOrchestrator({
        events: LIST_WORKERS_TURN.slice(0, 1),
        answer: answered({ outcome: 'aborted' })
      }).orchestrator,
      lines
    ).ask(prompt())
    await openOrchestrator(
      failed.web,
      fakeOrchestrator({ answer: new Error('The model gateway answered 502.') })
        .orchestrator,
      lines
    ).ask(prompt())

    expect(stopped.calls.slice(-LAST_TWO_CALLS)).toStrictEqual([
      'text "\\n\\nHalted."',
      'stop active'
    ])
    expect(failed.calls.slice(-LAST_TWO_CALLS)).toStrictEqual([
      'post 100.0001: Broken.',
      'status 100.0001 active'
    ])
  })

  it('ends a turn that its budget stopped with the budget line only', async () => {
    const { calls, web } = recordSlack()
    const budgetEnd: StreamChunk = {
      type: EventType.CUSTOM,
      name: BUDGET_END_EVENT,
      value: { reason: 'budget', message: 'The orchestrator used its budget.' }
    }

    await openOrchestrator(
      web,
      fakeOrchestrator({
        events: [budgetEnd],
        answer: answered({ outcome: 'aborted' })
      }).orchestrator
    ).ask(prompt())

    expect(calls.slice(-LAST_TWO_CALLS)).toStrictEqual([
      'text "\\n\\nThe orchestrator used its budget."',
      'stop active'
    ])
  })

  it('posts the whole answer when the stream breaks', async () => {
    const { calls, web } = recordSlack({ failStreamAt: 5 })

    await openOrchestrator(
      web,
      fakeOrchestrator({ events: LIST_WORKERS_TURN }).orchestrator
    ).ask(prompt())

    expect(calls.slice(-LAST_TWO_CALLS)).toStrictEqual([
      'post 100.0001: Alpha works on TASK-7.',
      'status 100.0001 active'
    ])
  })

  it('tells the thread when its turn fails, then leaves the processing status', async () => {
    const { calls, web } = recordSlack()

    await openOrchestrator(
      web,
      fakeOrchestrator({ answer: new Error('The model gateway answered 502.') })
        .orchestrator
    ).ask(prompt())

    expect(calls.slice(-LAST_TWO_CALLS)).toStrictEqual([
      'post 100.0001: An error stopped me. The host logs say which one.',
      'status 100.0001 active'
    ])
  })
})

describe('the replies and the stops of an orchestrator thread', () => {
  it('answers a reply only in a thread it holds, and reads the store once per thread', async () => {
    const { web } = recordSlack()
    const fake = fakeOrchestrator({
      heldThreads: [`slack/${TEST_CHANNEL}/100.0001`]
    })
    const threads = openOrchestrator(web, fake.orchestrator)

    await threads.reply(prompt({ ts: '100.0002', text: 'And then?' }))
    await threads.reply(prompt({ ts: '100.0003', text: 'And after?' }))
    await threads.reply(prompt({ threadTs: '200.0001', ts: '200.0002' }))
    await threads.reply(prompt({ user: COLLEAGUE, threadTs: '300.0001' }))

    expect(
      fake.asked.map(({ message }) => {
        return message
      })
    ).toStrictEqual(['And then?', 'And after?'])
    expect(fake.holdsReads()).toBe(2)
  })

  it('stops its turn on the stop button of an allowed person, and leaves the status when nothing runs', async () => {
    const running = recordSlack()
    const idle = recordSlack()
    const runningFake = fakeOrchestrator()
    const idleFake = fakeOrchestrator({ isRunning: false })
    const thread = { channel: TEST_CHANNEL, threadTs: '100.0001' }

    await openOrchestrator(running.web, runningFake.orchestrator).stop(
      thread,
      COLLEAGUE
    )
    await openOrchestrator(running.web, runningFake.orchestrator).stop(
      thread,
      STARTER
    )
    await openOrchestrator(idle.web, idleFake.orchestrator).stop(
      thread,
      STARTER
    )

    expect(runningFake.stops).toStrictEqual([
      `slack/${TEST_CHANNEL}/100.0001 ${STARTER}`
    ])
    expect(running.calls).toStrictEqual([])
    expect(idle.calls).toStrictEqual(['status 100.0001 active'])
  })
})

describe('the orchestrator threads of the allowed channels', () => {
  it('holds a thread of an allowed channel, and no thread of another channel or of a worker', () => {
    const isAllowedThread = isOrchestratorThreadIn([TEAM_CHANNEL])

    expect(isAllowedThread('slack/C_TEAM/1.0001')).toBe(true)
    expect(isAllowedThread('slack/C_TEAMS/1.0001')).toBe(false)
    expect(isAllowedThread('slack/C_TEST/1.0001')).toBe(false)
    expect(isAllowedThread('9fe236f0-b749-4156-83be-6bb5ec7d0ea9')).toBe(false)
  })
})
