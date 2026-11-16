import { createHmac } from 'node:crypto'
import { Chat } from 'chat'
import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import { z } from 'zod'
import { createSlackAdapter, type SlackAdapter } from '@chat-adapter/slack'
import { createMemoryState } from '@chat-adapter/state-memory'
import { toChatLogger, type ChatLogSource } from '#/connection/chat-logger.ts'
import type { PlatformExtras } from '#/connection/chat-surface.ts'

function ignore() {}

export const SILENT_CHAT_LOGGER: ChatLogSource = {
  debug: ignore,
  info: ignore,
  warn: ignore,
  error: ignore,
  child: () => {
    return SILENT_CHAT_LOGGER
  }
}

export const BOT_TOKEN = 'xoxb-test-bot-token'

export const BOT_USER = 'U_BOT'

export const TEAM = 'T_TEAM'

const SIGNING_SECRET = 'test-signing-secret'

const WEBHOOK_URL = 'https://workcell.example.com/slack/events'

const MILLISECONDS_PER_SECOND = 1_000

const SIGNED_AT = new Date('2026-11-16T09:00:00Z')

const SIGNED_AT_SECONDS = String(SIGNED_AT.getTime() / MILLISECONDS_PER_SECOND)

const READ_METHODS = new Set([
  'auth.test',
  'users.info',
  'conversations.info',
  'conversations.replies'
])

const formBodySchema = z.record(z.string(), z.string())

export type SlackCall = { method: string; body: Record<string, string> }

type SlackAnswer = Record<string, unknown>

function readAnswer({ method, body }: SlackCall) {
  if (method === 'auth.test') {
    return { ok: true, user_id: BOT_USER, bot_id: 'B_BOT', team_id: TEAM }
  }

  if (method === 'users.info') {
    return {
      ok: true,
      user: {
        id: body.user,
        name: body.user,
        profile: { display_name: body.user }
      }
    }
  }

  if (method === 'conversations.info') {
    return { ok: true, channel: { id: body.channel, name: body.channel } }
  }

  return { ok: true, messages: [] }
}

export function useSlackApi() {
  const calls: SlackCall[] = []
  const overrides = new Map<string, SlackAnswer>()

  const server = setupServer(
    http.post('https://slack.com/api/:method', async ({ request, params }) => {
      const { token: _token, ...body } = formBodySchema.parse(
        Object.fromEntries(new URLSearchParams(await request.text()))
      )
      const call = { method: z.string().parse(params.method), body }

      const override = overrides.get(call.method)

      if (override !== undefined) {
        calls.push(call)

        return HttpResponse.json(override)
      }

      if (READ_METHODS.has(call.method)) {
        return HttpResponse.json(readAnswer(call))
      }

      calls.push(call)
      const ts = `${calls.length}.0001`

      return HttpResponse.json({
        ok: true,
        ts,
        message_ts: ts,
        channel: body.channel
      })
    })
  )

  beforeAll(() => {
    server.listen({ onUnhandledFrame: 'error' })
  })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: SIGNED_AT })
    calls.length = 0
    overrides.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  afterAll(() => {
    server.close()
  })

  return {
    calls,
    answer: (method: string, answer: SlackAnswer) => {
      overrides.set(method, answer)
    },
    writes: (method: string) => {
      return calls.filter((call) => {
        return call.method === method
      })
    }
  }
}

export type SlackApi = ReturnType<typeof useSlackApi>

async function settleAll(tasks: Promise<unknown>[]) {
  let settled = 0

  while (settled < tasks.length) {
    const pending = tasks.slice(settled)
    settled = tasks.length
    // oxlint-disable-next-line no-await-in-loop -- a settled task can queue the next one, as the agent session stop does
    await Promise.allSettled(pending)
  }
}

function signedRequest(body: string, contentType: string) {
  const signature = createHmac('sha256', SIGNING_SECRET)
    .update(`v0:${SIGNED_AT_SECONDS}:${body}`)
    .digest('hex')

  return new Request(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'x-slack-request-timestamp': SIGNED_AT_SECONDS,
      'x-slack-signature': `v0=${signature}`
    },
    body
  })
}

type EventDelivery = { eventId?: string; isShared?: boolean }

export function slackSessionStatus(slack: SlackAdapter): PlatformExtras {
  return {
    setStatus: async (threadId, status) => {
      const { channel, threadTs } = slack.decodeThreadId(threadId)
      await slack.setSessionStatus(channel, threadTs, status)
    }
  }
}

export function openSlackChat() {
  const logger = toChatLogger(SILENT_CHAT_LOGGER)
  const slack = createSlackAdapter({
    botToken: BOT_TOKEN,
    signingSecret: SIGNING_SECRET,
    agentView: true,
    logger
  })
  const chat = new Chat({
    userName: 'workcell',
    adapters: { slack },
    state: createMemoryState(),
    concurrency: 'concurrent',
    logger
  })
  let deliveries = 0

  const receive = async (request: Request) => {
    const tasks: Promise<unknown>[] = []
    const response = await chat.webhooks.slack(request, {
      waitUntil: (task) => {
        tasks.push(task)
      }
    })

    return { isAcknowledged: response.ok, handled: settleAll(tasks) }
  }

  const receiveEvent = (
    event: Record<string, unknown>,
    { eventId, isShared = false }: EventDelivery = {}
  ) => {
    deliveries += 1

    return receive(
      signedRequest(
        JSON.stringify({
          type: 'event_callback',
          team_id: TEAM,
          api_app_id: 'A_APP',
          event_id: eventId ?? `Ev${deliveries}`,
          event_time: 1_793_886_000,
          is_ext_shared_channel: isShared,
          event
        }),
        'application/json'
      )
    )
  }

  const receiveClick = (payload: Record<string, unknown>) => {
    return receive(
      signedRequest(
        new URLSearchParams({ payload: JSON.stringify(payload) }).toString(),
        'application/x-www-form-urlencoded'
      )
    )
  }

  return {
    chat,
    slack,
    receiveEvent,
    receiveClick,
    deliverEvent: async (
      event: Record<string, unknown>,
      delivery?: EventDelivery
    ) => {
      const { handled } = await receiveEvent(event, delivery)
      await handled
    },
    deliverClick: async (payload: Record<string, unknown>) => {
      const { handled } = await receiveClick(payload)
      await handled
    },
    [Symbol.asyncDispose]: async () => {
      await chat.shutdown()
    }
  }
}
