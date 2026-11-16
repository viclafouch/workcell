import { z } from 'zod'
import { App, SocketModeReceiver, type Receiver } from '@slack/bolt'
import type { WorkerApproval } from '@workcell/core'
import { SLACK_LINES, type SlackLines } from '#/prompts/slack.ts'
import {
  toBoltLogger,
  type BoltLogSource,
  type LogLine
} from './bolt-logger.ts'
import type { SlackThread } from './channel-poster.ts'
import { WEB_API_OPTIONS } from './slack-web.ts'

function plainText(slackText: string) {
  return slackText
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

export const SLACK_SECRET_NAMES = [
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN'
] as const

export const APPROVAL_ACTIONS = {
  once: 'worker_approval_once',
  reject: 'worker_approval_reject'
} as const

export const LINK_ACTION_PREFIX = 'worker_link_'

const STOP_SHORTCUT = 'stop_worker'

const REDELIVERY_WINDOW_MS = 7_200_000

const LINK_ACTION_IDS = new RegExp(`^${LINK_ACTION_PREFIX}`, 'u')

const APPROVAL_ACTION_IDS = new RegExp(
  `^(${Object.values(APPROVAL_ACTIONS).join('|')})$`,
  'u'
)

const envelopeSchema = z.object({
  event_id: z.string(),
  is_ext_shared_channel: z.boolean().optional()
})

const approvalClickSchema = z.object({
  user: z.object({ id: z.string() }),
  channel: z.object({ id: z.string() }),
  message: z.object({
    ts: z.string(),
    thread_ts: z.string(),
    text: z.string()
  }),
  actions: z.tuple([
    z.object({
      action_id: z.enum([APPROVAL_ACTIONS.once, APPROVAL_ACTIONS.reject]),
      value: z.string()
    })
  ])
})

const messageShortcutSchema = z.object({
  user: z.object({ id: z.string() }),
  channel: z.object({ id: z.string() }),
  message: z.object({ ts: z.string(), thread_ts: z.string().optional() })
})

export type SlackPrompt = SlackThread & {
  user: string
  team: string
  ts: string
  text: string
}

export type ApprovalClick = {
  user: string
  waitId: string
  answer: WorkerApproval['answer']
  ts: string
  asked: string
  tell: (text: string) => Promise<void>
}

export type OrchestratorRoute = {
  ask: (prompt: SlackPrompt) => Promise<void>
  reply: (prompt: SlackPrompt) => Promise<void>
  stop: (thread: SlackThread, user: string) => Promise<void>
}

export type ThreadRoute = {
  reply: (reply: SlackPrompt) => Promise<void>
  approve: (click: ApprovalClick) => Promise<void>
  stop: (user: string) => Promise<void>
}

type ConnectionLog = BoltLogSource & {
  info: LogLine
  warn: LogLine
  error: LogLine
}

type OpenSlackConnectionParams = {
  botToken: string
  appToken: string
  orchestrator: OrchestratorRoute
  logger: { child: (bindings: Record<string, unknown>) => ConnectionLog }
  routeThread?: (thread: SlackThread) => ThreadRoute | undefined
  receiver?: Receiver
  lines?: SlackLines
}

function createSeenEvents() {
  const expiries = new Map<string, number>()

  return (eventId: string) => {
    const now = Temporal.Now.instant().epochMilliseconds

    for (const [seenId, expiresAt] of expiries) {
      if (expiresAt > now) {
        break
      }

      expiries.delete(seenId)
    }

    if (expiries.has(eventId)) {
      return true
    }

    expiries.set(eventId, now + REDELIVERY_WINDOW_MS)

    return false
  }
}

function createSocketModeReceiver(appToken: string, logger: ConnectionLog) {
  const receiver = new SocketModeReceiver({
    appToken,
    logger: toBoltLogger(logger)
  })
  receiver.client.on('connected', () => {
    logger.info({}, 'Slack connected')
  })
  receiver.client.on('reconnecting', () => {
    logger.warn({}, 'Slack reconnects')
  })

  return receiver
}

export async function openSlackConnection({
  botToken,
  appToken,
  orchestrator,
  logger,
  routeThread,
  receiver,
  lines = SLACK_LINES
}: OpenSlackConnectionParams) {
  const slackLogger = logger.child({ module: 'slack' })
  const appReceiver =
    receiver ?? createSocketModeReceiver(appToken, slackLogger)
  const app = new App({
    token: botToken,
    receiver: appReceiver,
    logger: toBoltLogger(slackLogger),
    convoStore: false,
    deferInitialization: true,
    extendedErrorHandler: true,
    clientOptions: WEB_API_OPTIONS
  })
  const isSeen = createSeenEvents()
  const routeOf = (channel: string, threadTs: string | undefined) => {
    return threadTs === undefined
      ? undefined
      : routeThread?.({ channel, threadTs })
  }

  app.use(async ({ body, next }) => {
    const envelope = envelopeSchema.safeParse(body)

    if (!envelope.success) {
      await next()

      return
    }

    const { event_id: eventId, is_ext_shared_channel: isShared } = envelope.data

    if (isShared === true) {
      slackLogger.info(
        { eventId },
        'slack event of a shared channel left alone'
      )

      return
    }

    if (isSeen(eventId)) {
      slackLogger.info({ eventId }, 'slack event already handled')

      return
    }

    await next()
  })

  app.event('app_mention', async ({ event, context, body }) => {
    if (event.user === undefined || event.bot_id !== undefined) {
      return
    }

    const prompt = {
      channel: event.channel,
      threadTs: event.thread_ts ?? event.ts,
      user: event.user,
      team: context.teamId ?? body.team_id,
      ts: event.ts,
      text: plainText(
        event.text.replaceAll(`<@${context.botUserId}>`, '').trim()
      )
    }
    const route = routeOf(event.channel, event.thread_ts)

    await (route === undefined ? orchestrator.ask(prompt) : route.reply(prompt))
  })

  app.event('message', async ({ event, context, body }) => {
    if (
      event.subtype !== undefined &&
      event.subtype !== 'file_share' &&
      event.subtype !== 'thread_broadcast'
    ) {
      return
    }

    if ('bot_id' in event && event.bot_id !== undefined) {
      return
    }

    const text = event.text ?? ''
    const isMention = text.includes(`<@${context.botUserId}>`)
    const prompt = {
      channel: event.channel,
      threadTs: event.thread_ts ?? event.ts,
      user: event.user,
      team: context.teamId ?? body.team_id,
      ts: event.ts,
      text: plainText(text)
    }
    const route = routeOf(event.channel, event.thread_ts)

    if (route !== undefined) {
      if (!isMention) {
        await route.reply(prompt)
      }

      return
    }

    if (event.channel_type === 'im') {
      await orchestrator.ask(prompt)

      return
    }

    if (!isMention && event.thread_ts !== undefined) {
      await orchestrator.reply(prompt)
    }
  })

  app.action(
    { type: 'block_actions', action_id: APPROVAL_ACTION_IDS },
    async ({ ack, body, respond }) => {
      await ack()
      const click = approvalClickSchema.safeParse(body)

      if (!click.success) {
        slackLogger.warn(
          { error: click.error },
          'approval click with no worker thread left alone'
        )

        return
      }

      const { user, channel, message, actions } = click.data
      const [{ action_id: actionId, value: waitId }] = actions
      const tell = async (text: string) => {
        await respond({
          response_type: 'ephemeral',
          replace_original: false,
          text
        })
      }
      const route = routeOf(channel.id, message.thread_ts)

      if (route === undefined) {
        await tell(lines.settledApproval)

        return
      }

      await route.approve({
        user: user.id,
        waitId,
        answer: actionId === APPROVAL_ACTIONS.once ? 'once' : 'reject',
        ts: message.ts,
        asked: message.text,
        tell
      })
    }
  )

  app.action(
    { type: 'block_actions', action_id: LINK_ACTION_IDS },
    async ({ ack }) => {
      await ack()
    }
  )

  app.shortcut(
    { type: 'message_action', callback_id: STOP_SHORTCUT },
    async ({ ack, shortcut, respond }) => {
      await ack()
      const { channel, message, user } = messageShortcutSchema.parse(shortcut)
      const route = routeOf(channel.id, message.thread_ts ?? message.ts)

      if (route === undefined) {
        await respond({
          response_type: 'ephemeral',
          replace_original: false,
          text: lines.noWorkerInThread
        })

        return
      }

      await route.stop(user.id)
    }
  )

  app.event('agent_session_stopped', async ({ event }) => {
    const thread = { channel: event.channel, threadTs: event.thread_ts }
    const route = routeOf(event.channel, event.thread_ts)

    await (route === undefined
      ? orchestrator.stop(thread, event.user)
      : route.stop(event.user))
  })

  app.error(async ({ error, body }: { error: Error; body: unknown }) => {
    const envelope = envelopeSchema.safeParse(body)
    slackLogger.error(
      { error, eventId: envelope.data?.event_id },
      'slack listener failed'
    )
  })

  await app.init()
  await app.start()

  return {
    [Symbol.asyncDispose]: async () => {
      const socketClosed =
        appReceiver instanceof SocketModeReceiver
          ? new Promise((resolve) => {
              appReceiver.client.once('disconnected', resolve)
            })
          : undefined
      await app.stop()
      await socketClosed
    }
  }
}
