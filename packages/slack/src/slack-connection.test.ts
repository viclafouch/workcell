import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { App, Receiver } from '@slack/bolt'
import type { OrchestratorRoute } from './orchestrator-threads.ts'
import {
  openSlackConnection,
  type ApprovalClick,
  type SlackPrompt,
  type ThreadRoute
} from './slack-connection.ts'
import { SILENT_SLACK_LOGGER } from './test-doubles.ts'

const BOT_TOKEN = 'xoxb-test-bot-token'

const BOT_USER = 'U_BOT'

const STARTER = 'U_STARTER'

const CHANNEL = 'C_TEST'

const TEAM = 'T_TEAM'

const slackCallSchema = z.object({
  method: z.string(),
  body: z.record(z.string(), z.string())
})

type SlackCall = z.infer<typeof slackCallSchema>

type OrchestratorCall = { kind: 'ask' | 'reply' | 'stop'; detail: string }

let calls: SlackCall[]

let deliveredEvents: number

let ephemeralReplies: unknown[]

const RESPONSE_URL = 'https://hooks.slack.com/actions/T_TEAM/1/response'

const network = setupServer(
  http.post(RESPONSE_URL, async ({ request }) => {
    ephemeralReplies.push(await request.json())

    return HttpResponse.text('ok')
  }),
  http.post('https://slack.com/api/:method', async ({ request, params }) => {
    if (request.headers.get('authorization') !== `Bearer ${BOT_TOKEN}`) {
      return HttpResponse.json({ ok: false, error: 'invalid_auth' })
    }

    if (params.method === 'auth.test') {
      return HttpResponse.json({
        ok: true,
        user_id: BOT_USER,
        bot_id: 'B_BOT',
        team_id: 'T_TEAM'
      })
    }

    calls.push(
      slackCallSchema.parse({
        method: params.method,
        body: Object.fromEntries(new URLSearchParams(await request.text()))
      })
    )

    return HttpResponse.json({ ok: true, ts: `${calls.length}.0001` })
  })
)

function createTestReceiver() {
  let bolt: App | undefined
  const receiver: Receiver = {
    init: (app) => {
      bolt = app
    },
    start: async () => {},
    stop: async () => {}
  }
  const deliver = (
    event: Record<string, unknown>,
    { eventId, isShared = false }: { eventId?: string; isShared?: boolean } = {}
  ) => {
    if (!bolt) {
      throw new Error('The connection did not open the receiver.')
    }

    deliveredEvents += 1
    const acks: string[] = []
    const delivery = bolt.processEvent({
      body: {
        type: 'event_callback',
        team_id: 'T_TEAM',
        api_app_id: 'A_APP',
        event_id: eventId ?? `Ev${deliveredEvents}`,
        event_time: 1_793_886_000,
        is_ext_shared_channel: isShared,
        event
      },
      ack: async () => {
        acks.push('ack')
      }
    })

    return { acks, delivery }
  }

  const click = (body: Record<string, unknown>) => {
    if (!bolt) {
      throw new Error('The connection did not open the receiver.')
    }

    const acks: string[] = []
    const delivery = bolt.processEvent({
      body,
      ack: async () => {
        acks.push('ack')
      }
    })

    return { acks, delivery }
  }

  return { receiver, deliver, click }
}

function recordOrchestrator(hold: Promise<null> = Promise.resolve(null)) {
  const orchestratorCalls: OrchestratorCall[] = []
  const prompts: SlackPrompt[] = []

  const record = (kind: 'ask' | 'reply') => {
    return async (prompt: SlackPrompt) => {
      prompts.push(prompt)
      orchestratorCalls.push({
        kind,
        detail: `${prompt.threadTs} ${prompt.text}`
      })
      await hold
    }
  }

  const orchestrator: OrchestratorRoute = {
    ask: record('ask'),
    reply: record('reply'),
    stop: async ({ threadTs }, user) => {
      orchestratorCalls.push({ kind: 'stop', detail: `${threadTs} ${user}` })
    }
  }

  return { orchestrator, orchestratorCalls, prompts }
}

async function openTestConnection(
  orchestrator: OrchestratorRoute,
  routeThread?: (thread: {
    channel: string
    threadTs: string
  }) => ThreadRoute | undefined
) {
  const { receiver, deliver, click } = createTestReceiver()
  const connection = await openSlackConnection({
    botToken: BOT_TOKEN,
    appToken: 'xapp-test-app-token',
    orchestrator,
    routeThread,
    logger: SILENT_SLACK_LOGGER,
    receiver
  })

  return {
    deliver,
    click,
    [Symbol.asyncDispose]: () => {
      return connection[Symbol.asyncDispose]()
    }
  }
}

function mention(text: string, ts: string) {
  return {
    type: 'app_mention',
    user: STARTER,
    channel: CHANNEL,
    text: `<@${BOT_USER}> ${text}`,
    ts
  }
}

function message(fields: Record<string, string>) {
  return {
    type: 'message',
    user: STARTER,
    channel: CHANNEL,
    channel_type: 'channel',
    ...fields
  }
}

function approvalClick(actionId: string, threadTs: string) {
  return {
    type: 'block_actions',
    team: { id: TEAM },
    user: { id: STARTER },
    api_app_id: 'A_APP',
    token: 'verification-token',
    trigger_id: 'trigger-1',
    response_url: RESPONSE_URL,
    container: {
      type: 'message',
      message_ts: `${threadTs}2`,
      channel_id: CHANNEL,
      is_ephemeral: false
    },
    channel: { id: CHANNEL, name: 'workers' },
    message: {
      type: 'message',
      ts: `${threadTs}2`,
      thread_ts: threadTs,
      text: 'May I run this?'
    },
    actions: [
      {
        type: 'button',
        action_id: actionId,
        block_id: 'approval',
        value: 'wait-1',
        action_ts: '1793886000.000001'
      }
    ]
  }
}

function stopShortcut(threadTs: string | undefined, ts: string) {
  return {
    type: 'message_action',
    callback_id: 'stop_worker',
    team: { id: TEAM },
    user: { id: STARTER },
    channel: { id: CHANNEL, name: 'workers' },
    message: {
      type: 'message',
      ts,
      text: 'I read the task',
      thread_ts: threadTs
    },
    message_ts: ts,
    trigger_id: 'trigger-2',
    response_url: RESPONSE_URL,
    action_ts: '1793886000.000002',
    token: 'verification-token'
  }
}

function linkClick(threadTs: string) {
  return {
    ...approvalClick('worker_link_ticket', threadTs),
    actions: [
      {
        type: 'button',
        action_id: 'worker_link_ticket',
        block_id: 'links',
        action_ts: '1793886000.000003'
      }
    ]
  }
}

function sessionStopped(threadTs: string) {
  return {
    type: 'agent_session_stopped',
    channel: CHANNEL,
    user: STARTER,
    thread_ts: threadTs,
    streaming_message_ts: [],
    event_ts: `${threadTs}9`
  }
}

describe('openSlackConnection', () => {
  beforeAll(() => {
    network.listen({ onUnhandledFrame: 'error' })
  })

  beforeEach(() => {
    calls = []
    deliveredEvents = 0
    ephemeralReplies = []
  })

  afterAll(() => {
    network.close()
  })

  it('hands a mention to the orchestrator with its thread, its author, its team and its timestamp', async () => {
    const { orchestrator, prompts } = recordOrchestrator()
    await using connection = await openTestConnection(orchestrator)

    await connection.deliver(mention('what runs?', '100.0001')).delivery

    expect(prompts).toStrictEqual([
      {
        channel: CHANNEL,
        threadTs: '100.0001',
        user: STARTER,
        team: TEAM,
        ts: '100.0001',
        text: 'what runs?'
      }
    ])
    expect(calls).toStrictEqual([])
  })

  it('hands the orchestrator the text a person typed, with the characters Slack escapes', async () => {
    const { orchestrator, orchestratorCalls } = recordOrchestrator()
    await using connection = await openTestConnection(orchestrator)

    await connection.deliver(
      mention('read &lt;a branch&gt; &amp;lt;', '150.0001')
    ).delivery
    await connection.deliver(
      message({
        text: 'and &lt;b&gt;?',
        ts: '150.0002',
        thread_ts: '150.0001'
      })
    ).delivery

    expect(orchestratorCalls).toStrictEqual([
      { kind: 'ask', detail: '150.0001 read <a branch> &lt;' },
      { kind: 'reply', detail: '150.0001 and <b>?' }
    ])
  })

  it('acknowledges an event before its turn ends', async () => {
    const turn = Promise.withResolvers<null>()
    const { orchestrator, orchestratorCalls } = recordOrchestrator(turn.promise)
    await using connection = await openTestConnection(orchestrator)

    const { acks, delivery } = connection.deliver(
      mention('long task', '200.0001')
    )
    await expect
      .poll(() => {
        return orchestratorCalls
      })
      .toHaveLength(1)

    expect(acks).toStrictEqual(['ack'])

    turn.resolve(null)
    await delivery
  })

  it('runs an event that Slack sends twice once', async () => {
    const { orchestrator, orchestratorCalls } = recordOrchestrator()
    await using connection = await openTestConnection(orchestrator)

    await connection.deliver(mention('hi', '300.0001'), { eventId: 'EvTwice' })
      .delivery
    await connection.deliver(mention('hi', '300.0001'), { eventId: 'EvTwice' })
      .delivery

    expect(orchestratorCalls).toHaveLength(1)
  })

  it('hands a mention, a thread reply, a direct message and the stop button to the orchestrator', async () => {
    const { orchestrator, orchestratorCalls } = recordOrchestrator()
    await using connection = await openTestConnection(orchestrator)

    await connection.deliver(mention('start', '600.0001')).delivery
    await connection.deliver(
      message({ text: 'and then?', ts: '600.0002', thread_ts: '600.0001' })
    ).delivery
    await connection.deliver(
      message({
        subtype: 'file_share',
        text: 'the log',
        ts: '600.0003',
        thread_ts: '600.0001'
      })
    ).delivery
    await connection.deliver(
      message({
        text: `<@${BOT_USER}> hello`,
        ts: '700.0001',
        channel: 'D_STARTER',
        channel_type: 'im'
      })
    ).delivery
    await connection.deliver(sessionStopped('600.0001')).delivery

    expect(orchestratorCalls).toStrictEqual([
      { kind: 'ask', detail: '600.0001 start' },
      { kind: 'reply', detail: '600.0001 and then?' },
      { kind: 'reply', detail: '600.0001 the log' },
      { kind: 'ask', detail: `700.0001 <@${BOT_USER}> hello` },
      { kind: 'stop', detail: `600.0001 ${STARTER}` }
    ])
  })

  it('leaves alone the messages of other bots and the events of a shared channel', async () => {
    const { orchestrator, orchestratorCalls } = recordOrchestrator()
    await using connection = await openTestConnection(orchestrator)

    await connection.deliver({
      ...mention('loop', '660.0001'),
      bot_id: 'B_OTHER'
    }).delivery
    await connection.deliver(
      message({
        text: 'loop',
        ts: '660.0002',
        channel: 'D_OTHER',
        channel_type: 'im',
        bot_id: 'B_OTHER'
      })
    ).delivery
    await connection.deliver(mention('outside', '660.0003'), { isShared: true })
      .delivery

    expect(orchestratorCalls).toStrictEqual([])
    expect(calls).toStrictEqual([])
  })

  it('leaves alone a channel message outside a thread, the message copy of a mention, and an edit', async () => {
    const { orchestrator, orchestratorCalls } = recordOrchestrator()
    await using connection = await openTestConnection(orchestrator)

    await connection.deliver(message({ text: 'lunch?', ts: '800.0001' }))
      .delivery
    await connection.deliver(
      message({
        text: `<@${BOT_USER}> hi`,
        ts: '800.0004',
        thread_ts: '800.0002'
      })
    ).delivery
    await connection.deliver(
      message({ subtype: 'message_changed', ts: '800.0005' })
    ).delivery

    expect(orchestratorCalls).toStrictEqual([])
  })
})

describe('a worker thread in the Slack connection', () => {
  beforeAll(() => {
    network.listen({ onUnhandledFrame: 'error' })
  })

  beforeEach(() => {
    calls = []
    deliveredEvents = 0
    ephemeralReplies = []
  })

  afterAll(() => {
    network.close()
  })

  it('hands a reply, a mention and the stop button of a worker thread to its route, and never to the orchestrator', async () => {
    const routed: string[] = []
    const { orchestrator, orchestratorCalls } = recordOrchestrator()
    const routes = new Map<string, ThreadRoute>([
      [
        '900.0001',
        {
          reply: async ({ user, text, ts }) => {
            routed.push(`${user} ${ts} ${text}`)
          },
          approve: async () => {
            throw new Error('This test clicks no approval.')
          },
          stop: async (user) => {
            routed.push(`${user} stop`)
          }
        }
      ]
    ])
    await using connection = await openTestConnection(
      orchestrator,
      (thread) => {
        return routes.get(thread.threadTs)
      }
    )

    await connection.deliver(
      message({
        text: 'keep the button',
        ts: '900.0002',
        thread_ts: '900.0001'
      })
    ).delivery
    await connection.deliver({
      ...mention('and the title', '900.0003'),
      thread_ts: '900.0001'
    }).delivery
    await connection.deliver(
      message({
        text: `<@${BOT_USER}> and the title`,
        ts: '900.0003',
        thread_ts: '900.0001'
      })
    ).delivery
    await connection.deliver(sessionStopped('900.0001')).delivery

    expect(routed).toStrictEqual([
      `${STARTER} 900.0002 keep the button`,
      `${STARTER} 900.0003 and the title`,
      `${STARTER} stop`
    ])
    expect(orchestratorCalls).toStrictEqual([])
    expect(calls).toStrictEqual([])
  })

  it('acknowledges an approval click at once, hands it to the route of its worker thread, and tells a click on a finished thread that it is settled', async () => {
    const approved = Promise.withResolvers<null>()
    const clicks: ApprovalClick[] = []
    const { orchestrator, orchestratorCalls } = recordOrchestrator()
    const route: ThreadRoute = {
      reply: async () => {
        throw new Error('This test sends no reply.')
      },
      approve: async (click) => {
        clicks.push(click)
        await approved.promise
      },
      stop: async () => {
        throw new Error('This test stops nothing.')
      }
    }
    const routes = new Map([['900.0001', route]])
    await using connection = await openTestConnection(
      orchestrator,
      (thread) => {
        return routes.get(thread.threadTs)
      }
    )

    const { acks, delivery } = connection.click(
      approvalClick('worker_approval_once', '900.0001')
    )
    await expect
      .poll(() => {
        return clicks
      })
      .toHaveLength(1)

    expect(acks).toStrictEqual(['ack'])

    approved.resolve(null)
    await delivery
    await connection.click(approvalClick('worker_approval_reject', '900.0001'))
      .delivery
    await connection.click(approvalClick('worker_approval_once', '800.0001'))
      .delivery

    expect(
      clicks.map(({ user, waitId, answer, ts, asked }) => {
        return { user, waitId, answer, ts, asked }
      })
    ).toStrictEqual([
      {
        user: STARTER,
        waitId: 'wait-1',
        answer: 'once',
        ts: '900.00012',
        asked: 'May I run this?'
      },
      {
        user: STARTER,
        waitId: 'wait-1',
        answer: 'reject',
        ts: '900.00012',
        asked: 'May I run this?'
      }
    ])
    expect(ephemeralReplies).toStrictEqual([
      {
        response_type: 'ephemeral',
        replace_original: false,
        text: 'This approval is settled already.'
      }
    ])
    expect(orchestratorCalls).toStrictEqual([])
    expect(calls).toStrictEqual([])
  })

  it('stops the worker of a thread from the message menu, and tells a thread with no worker so', async () => {
    const stops: string[] = []
    const { orchestrator, orchestratorCalls } = recordOrchestrator()
    const routes = new Map<string, ThreadRoute>([
      [
        '900.0001',
        {
          reply: async () => {
            throw new Error('This test sends no reply.')
          },
          approve: async () => {
            throw new Error('This test clicks no approval.')
          },
          stop: async (user) => {
            stops.push(user)
          }
        }
      ]
    ])
    await using connection = await openTestConnection(
      orchestrator,
      (thread) => {
        return routes.get(thread.threadTs)
      }
    )

    const { acks, delivery } = connection.click(
      stopShortcut('900.0001', '900.0005')
    )
    await delivery
    await connection.click(stopShortcut(undefined, '900.0001')).delivery
    await connection.click(stopShortcut(undefined, '800.0001')).delivery

    expect(acks).toStrictEqual(['ack'])
    expect(stops).toStrictEqual([STARTER, STARTER])
    expect(ephemeralReplies).toStrictEqual([
      {
        response_type: 'ephemeral',
        replace_original: false,
        text: 'No worker runs in this thread.'
      }
    ])
    expect(orchestratorCalls).toStrictEqual([])
  })

  it('acknowledges a click on a link button of a worker thread', async () => {
    const { orchestrator } = recordOrchestrator()
    await using connection = await openTestConnection(orchestrator)

    const { acks, delivery } = connection.click(linkClick('900.0001'))
    await delivery

    expect(acks).toStrictEqual(['ack'])
    expect(calls).toStrictEqual([])
  })
})
