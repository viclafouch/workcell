import { describe, expect, it } from 'vitest'
import {
  BOT_USER,
  openSlackChat,
  SILENT_CHAT_LOGGER,
  TEAM,
  useSlackApi
} from '#/__tests__/test-doubles.ts'
import {
  openChatConnection,
  type ApprovalClick,
  type ChatPrompt,
  type OrchestratorRoute,
  type ThreadRoute
} from '#/connection/chat-connection.ts'

const STARTER = 'U_STARTER'

const CHANNEL = 'C_TEST'

const WORKER_CHANNEL = 'C_WORKERS'

const WORKER_THREAD = `slack:${WORKER_CHANNEL}:900.0001`

const slackApi = useSlackApi()

type RoutedCall = {
  kind: string
  threadId: string
  user: string
  text: string
  inputId: string
}

function routedCall(kind: string, { thread, user, text, inputId }: ChatPrompt) {
  return { kind, threadId: thread.id, user, text, inputId }
}

function recordOrchestrator(hold: Promise<null> = Promise.resolve(null)) {
  const calls: RoutedCall[] = []
  const stops: string[] = []

  const orchestrator: OrchestratorRoute = {
    ask: async (prompt) => {
      calls.push(routedCall('ask', prompt))
      await hold
    },
    reply: async (prompt) => {
      calls.push(routedCall('reply', prompt))
    },
    stop: async (threadId, user) => {
      stops.push(`${threadId} ${user}`)
    }
  }

  return { orchestrator, calls, stops }
}

function recordWorkerRoute(hold: Promise<null> = Promise.resolve(null)) {
  const replies: RoutedCall[] = []
  const clicks: Omit<ApprovalClick, 'tell'>[] = []
  const stops: string[] = []

  const route: ThreadRoute = {
    reply: async (prompt) => {
      replies.push(routedCall('reply', prompt))
    },
    approve: async ({ tell, ...click }) => {
      clicks.push(click)
      await hold

      if (clicks.length > 1) {
        await tell('This approval is settled already.')
      }
    },
    stop: async (user) => {
      stops.push(user)
    }
  }

  return { route, replies, clicks, stops }
}

type OpenTestConnectionParams = {
  orchestrator: OrchestratorRoute
  workerRoute?: ThreadRoute
}

async function openTestConnection({
  orchestrator,
  workerRoute
}: OpenTestConnectionParams) {
  const slackChat = openSlackChat()
  const connection = await openChatConnection({
    chat: slackChat.chat,
    orchestrator,
    logger: SILENT_CHAT_LOGGER,
    routeThread: (threadId) => {
      return threadId === WORKER_THREAD ? workerRoute : undefined
    }
  })

  return {
    ...slackChat,
    [Symbol.asyncDispose]: () => {
      return connection[Symbol.asyncDispose]()
    }
  }
}

function mention(text: string, fields: Record<string, string> = {}) {
  return {
    type: 'app_mention',
    user: STARTER,
    channel: CHANNEL,
    text: `<@${BOT_USER}> ${text}`,
    ...fields
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

function sessionStopped(channel: string, threadTs: string) {
  return {
    type: 'agent_session_stopped',
    channel,
    user: STARTER,
    thread_ts: threadTs,
    streaming_message_ts: [],
    event_ts: `${threadTs}9`
  }
}

function buttonClick(actionId: string, value?: string) {
  return {
    type: 'block_actions',
    team: { id: TEAM },
    user: { id: STARTER, username: 'starter', name: 'starter', team_id: TEAM },
    api_app_id: 'A_APP',
    token: 'verification-token',
    trigger_id: 'trigger-1',
    response_url: 'https://hooks.slack.com/actions/T_TEAM/1/response',
    container: {
      type: 'message',
      message_ts: '900.0002',
      channel_id: WORKER_CHANNEL,
      is_ephemeral: false
    },
    channel: { id: WORKER_CHANNEL, name: 'workers' },
    message: {
      type: 'message',
      ts: '900.0002',
      thread_ts: '900.0001',
      text: 'May I run this?'
    },
    actions: [
      {
        type: 'button',
        action_id: actionId,
        block_id: 'actions',
        value,
        action_ts: '1793886000.000001'
      }
    ]
  }
}

function ephemeralTexts() {
  return slackApi.writes('chat.postEphemeral').map(({ body }) => {
    return `${body.user} ${body.channel} ${body.thread_ts} ${body.markdown_text}`
  })
}

describe('the chat connection of the orchestrator', () => {
  it('hands a mention to the orchestrator with its thread, its author, its text and its input id, then the replies of that thread', async () => {
    const recorded = recordOrchestrator()
    await using connection = await openTestConnection({
      orchestrator: recorded.orchestrator
    })

    await connection.deliverEvent(mention('what runs?', { ts: '100.0001' }))
    await connection.deliverEvent(
      message({ text: 'and then?', ts: '100.0002', thread_ts: '100.0001' })
    )
    await connection.deliverEvent(message({ text: 'lunch?', ts: '200.0001' }))

    expect(recorded.calls).toStrictEqual([
      {
        kind: 'ask',
        threadId: `slack:${CHANNEL}:100.0001`,
        user: STARTER,
        text: `@${BOT_USER} what runs?`,
        inputId: `chat:slack:${CHANNEL}:100.0001:100.0001`
      },
      {
        kind: 'reply',
        threadId: `slack:${CHANNEL}:100.0001`,
        user: STARTER,
        text: 'and then?',
        inputId: `chat:slack:${CHANNEL}:100.0001:100.0002`
      }
    ])
  })

  it('hands the orchestrator the URL behind each shortened link, and the files of the message', async () => {
    const files: ChatPrompt['files'][number][] = []
    const texts: string[] = []
    await using connection = await openTestConnection({
      orchestrator: {
        ...recordOrchestrator().orchestrator,
        ask: async (prompt) => {
          texts.push(prompt.text)
          files.push(...prompt.files)
        }
      }
    })

    await connection.deliverEvent({
      ...mention(
        'read <https://example.com/docs/guides/media|example.com/docs/…/media>',
        { ts: '150.0001' }
      ),
      attachments: [
        { from_url: 'https://example.com/docs/guides/media', title: 'Media' }
      ],
      files: [
        {
          id: 'F1',
          name: 'mockup.png',
          mimetype: 'image/png',
          size: 2048,
          url_private: 'https://files.slack.com/files-pri/T_TEAM-F1/mockup.png'
        }
      ]
    })

    expect(texts).toStrictEqual([
      `@${BOT_USER} read [example.com/docs/…/media](https://example.com/docs/guides/media)`
    ])
    expect(files).toMatchObject([
      { name: 'mockup.png', mimeType: 'image/png', size: 2048 }
    ])
  })

  it('hands a direct message to the orchestrator', async () => {
    const recorded = recordOrchestrator()
    await using connection = await openTestConnection({
      orchestrator: recorded.orchestrator
    })

    await connection.deliverEvent(
      message({
        text: 'hello',
        ts: '700.0001',
        channel: 'D_STARTER',
        channel_type: 'im'
      })
    )

    expect(recorded.calls).toStrictEqual([
      {
        kind: 'ask',
        threadId: 'slack:D_STARTER:700.0001',
        user: STARTER,
        text: 'hello',
        inputId: 'chat:slack:D_STARTER:700.0001:700.0001'
      }
    ])
  })

  it('hands the stop of an agent session to the orchestrator', async () => {
    const recorded = recordOrchestrator()
    await using connection = await openTestConnection({
      orchestrator: recorded.orchestrator
    })

    await connection.deliverEvent(sessionStopped(CHANNEL, '600.0001'))

    expect(recorded.stops).toStrictEqual([
      `slack:${CHANNEL}:600.0001 ${STARTER}`
    ])
  })

  it('runs a message that reaches it twice once', async () => {
    const recorded = recordOrchestrator()
    await using connection = await openTestConnection({
      orchestrator: recorded.orchestrator
    })

    await connection.deliverEvent(mention('hi', { ts: '300.0001' }))
    await connection.deliverEvent(mention('hi', { ts: '300.0001' }))
    await connection.deliverEvent(
      message({ text: `<@${BOT_USER}> hi`, ts: '300.0001' })
    )

    expect(recorded.calls).toHaveLength(1)
  })

  it('acknowledges an event before its turn ends', async () => {
    const turn = Promise.withResolvers<null>()
    const recorded = recordOrchestrator(turn.promise)
    await using connection = await openTestConnection({
      orchestrator: recorded.orchestrator
    })

    const { isAcknowledged, handled } = await connection.receiveEvent(
      mention('long task', { ts: '400.0001' })
    )
    await expect
      .poll(() => {
        return recorded.calls
      })
      .toHaveLength(1)

    expect(isAcknowledged).toBe(true)

    turn.resolve(null)
    await handled
  })

  it('leaves alone the messages of a shared channel', async () => {
    const recorded = recordOrchestrator()
    await using connection = await openTestConnection({
      orchestrator: recorded.orchestrator
    })
    await connection.chat.thread('slack:C_SHARED:500.0001').subscribe()

    await connection.deliverEvent(
      mention('outside', { channel: 'C_SHARED', ts: '510.0001' }),
      { isShared: true }
    )
    await connection.deliverEvent(
      message({
        channel: 'C_SHARED',
        text: 'and then?',
        ts: '500.0002',
        thread_ts: '500.0001'
      }),
      { isShared: true }
    )

    expect(recorded.calls).toStrictEqual([])
  })

  it('leaves alone its own messages, the messages of another bot and an edit', async () => {
    const recorded = recordOrchestrator()
    await using connection = await openTestConnection({
      orchestrator: recorded.orchestrator
    })
    await connection.deliverEvent(mention('start', { ts: '800.0001' }))
    recorded.calls.length = 0

    await connection.deliverEvent(
      message({
        user: BOT_USER,
        text: 'Alpha works on TASK-7.',
        ts: '800.0002',
        thread_ts: '800.0001'
      })
    )
    await connection.deliverEvent(
      message({
        user: 'U_OTHER_BOT',
        bot_id: 'B_OTHER_BOT',
        text: 'I am a bot too.',
        ts: '800.0004',
        thread_ts: '800.0001'
      })
    )
    await connection.deliverEvent(
      message({
        subtype: 'message_changed',
        ts: '800.0003',
        thread_ts: '800.0001'
      })
    )

    expect(recorded.calls).toStrictEqual([])
  })
})

describe('a worker thread in the chat connection', () => {
  it('hands a mention, then the replies with no mention and the stop of a worker thread to its route, and never to the orchestrator', async () => {
    const orchestrator = recordOrchestrator()
    const worker = recordWorkerRoute()
    await using connection = await openTestConnection({
      orchestrator: orchestrator.orchestrator,
      workerRoute: worker.route
    })

    await connection.deliverEvent(
      mention('and the title', {
        channel: WORKER_CHANNEL,
        ts: '900.0003',
        thread_ts: '900.0001'
      })
    )
    await connection.deliverEvent(
      message({
        channel: WORKER_CHANNEL,
        text: 'Draft',
        ts: '900.0004',
        thread_ts: '900.0001'
      })
    )
    await connection.deliverEvent(sessionStopped(WORKER_CHANNEL, '900.0001'))

    expect(worker.replies).toStrictEqual([
      {
        kind: 'reply',
        threadId: WORKER_THREAD,
        user: STARTER,
        text: `@${BOT_USER} and the title`,
        inputId: `chat:${WORKER_THREAD}:900.0003`
      },
      {
        kind: 'reply',
        threadId: WORKER_THREAD,
        user: STARTER,
        text: 'Draft',
        inputId: `chat:${WORKER_THREAD}:900.0004`
      }
    ])
    expect(worker.stops).toStrictEqual([STARTER])
    expect(orchestrator.calls).toStrictEqual([])
    expect(orchestrator.stops).toStrictEqual([])
  })

  it('acknowledges an approval click at once, hands it to the route with the question it answers, and lets the route tell the person', async () => {
    const approved = Promise.withResolvers<null>()
    const worker = recordWorkerRoute(approved.promise)
    slackApi.answer('conversations.replies', {
      ok: true,
      messages: [{ type: 'message', ts: '900.0002', text: 'May I run deploy?' }]
    })
    await using connection = await openTestConnection({
      orchestrator: recordOrchestrator().orchestrator,
      workerRoute: worker.route
    })

    const { isAcknowledged, handled } = await connection.receiveClick(
      buttonClick('worker_approval_once', 'wait-1')
    )
    await expect
      .poll(() => {
        return worker.clicks
      })
      .toHaveLength(1)

    expect(isAcknowledged).toBe(true)

    approved.resolve(null)
    await handled
    await connection.deliverClick(
      buttonClick('worker_approval_reject', 'wait-1')
    )

    expect(worker.clicks).toStrictEqual([
      {
        user: STARTER,
        waitId: 'wait-1',
        answer: 'once',
        messageId: '900.0002',
        asked: 'May I run deploy?'
      },
      {
        user: STARTER,
        waitId: 'wait-1',
        answer: 'reject',
        messageId: '900.0002',
        asked: 'May I run deploy?'
      }
    ])
    expect(ephemeralTexts()).toStrictEqual([
      `${STARTER} ${WORKER_CHANNEL} 900.0001 This approval is settled already.`
    ])
  })

  it('asks the default question when the clicked message is gone', async () => {
    const worker = recordWorkerRoute()
    await using connection = await openTestConnection({
      orchestrator: recordOrchestrator().orchestrator,
      workerRoute: worker.route
    })

    await connection.deliverClick(buttonClick('worker_approval_once', 'wait-1'))

    expect(worker.clicks).toMatchObject([{ asked: 'May I run this?' }])
  })

  it('tells an approval click on a thread with no worker that it is settled', async () => {
    const orchestrator = recordOrchestrator()
    await using connection = await openTestConnection({
      orchestrator: orchestrator.orchestrator
    })

    await connection.deliverClick(buttonClick('worker_approval_once', 'wait-1'))

    expect(ephemeralTexts()).toStrictEqual([
      `${STARTER} ${WORKER_CHANNEL} 900.0001 This approval is settled already.`
    ])
    expect(orchestrator.calls).toStrictEqual([])
  })

  it('stops the worker of a thread from its stop button, and tells a thread with no worker so', async () => {
    const worker = recordWorkerRoute()
    await using withWorker = await openTestConnection({
      orchestrator: recordOrchestrator().orchestrator,
      workerRoute: worker.route
    })
    await withWorker.deliverClick(buttonClick('worker_stop'))
    await using withoutWorker = await openTestConnection({
      orchestrator: recordOrchestrator().orchestrator
    })
    await withoutWorker.deliverClick(buttonClick('worker_stop'))

    expect(worker.stops).toStrictEqual([STARTER])
    expect(ephemeralTexts()).toStrictEqual([
      `${STARTER} ${WORKER_CHANNEL} 900.0001 No worker runs in this thread.`
    ])
  })

  it('leaves a click on a link button of a worker thread to the platform', async () => {
    const worker = recordWorkerRoute()
    await using connection = await openTestConnection({
      orchestrator: recordOrchestrator().orchestrator,
      workerRoute: worker.route
    })

    const { isAcknowledged, handled } = await connection.receiveClick(
      buttonClick('worker_link_task')
    )
    await handled

    expect(isAcknowledged).toBe(true)
    expect(worker.clicks).toStrictEqual([])
    expect(worker.stops).toStrictEqual([])
    expect(ephemeralTexts()).toStrictEqual([])
  })
})
