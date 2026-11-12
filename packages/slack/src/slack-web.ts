import { webApi } from '@slack/bolt'
import {
  toBoltLogger,
  type BoltLogSource,
  type LogLine
} from './bolt-logger.ts'
import {
  createChannelPoster,
  identityFields,
  type SlackIdentity,
  type SlackThread
} from './channel-poster.ts'

export const WEB_API_OPTIONS = {
  retryConfig: webApi.retryPolicies.fiveRetriesInFiveMinutes,
  timeout: 30_000,
  allowAbsoluteUrls: false
} satisfies webApi.WebClientOptions

const SESSION_TITLE_MAX_LENGTH = 200

export type SessionStatus = 'processing' | 'active' | 'suspended' | 'closed'

export type SlackTask = {
  id: string
  title: string
  status: 'in_progress' | 'complete' | 'error'
  details?: string
}

export type RateLimitedLogger = {
  child: (
    bindings: Record<string, unknown>
  ) => BoltLogSource & { warn: LogLine }
}

type StreamParams = SlackThread & {
  identity?: SlackIdentity
  recipient: { user: string; team: string }
}

type SetStatusParams = SlackThread & {
  status: SessionStatus
  identity?: SlackIdentity
  title?: string
  initiator?: string
}

type RenameParams = SlackThread & { title: string }

type CreateSlackWebParams = {
  botToken: string
  logger: RateLimitedLogger
}

export function createSlackWeb({ botToken, logger }: CreateSlackWebParams) {
  const slackLogger = logger.child({ module: 'slack' })
  const client = new webApi.WebClient(botToken, {
    ...WEB_API_OPTIONS,
    logger: toBoltLogger(slackLogger)
  })
  client.on(webApi.WebClientEvent.RATE_LIMITED, (retryAfterSeconds) => {
    slackLogger.warn({ retryAfterSeconds }, 'slack rate limits the host')
  })

  const setStatus = async ({
    channel,
    threadTs,
    status,
    identity,
    title,
    initiator
  }: SetStatusParams) => {
    await client.agents.sessions.setStatus({
      channel_id: channel,
      thread_ts: threadTs,
      status,
      title: title?.slice(0, SESSION_TITLE_MAX_LENGTH) || undefined,
      initiator_user_id: initiator,
      ...identityFields(identity)
    })
  }

  const rename = async ({ channel, threadTs, title }: RenameParams) => {
    await client.agents.sessions.rename({
      channel_id: channel,
      thread_ts: threadTs,
      title: title.slice(0, SESSION_TITLE_MAX_LENGTH)
    })
  }

  const stream = ({ channel, threadTs, identity, recipient }: StreamParams) => {
    const streamer = client.chatStream({
      channel,
      thread_ts: threadTs,
      recipient_user_id: recipient.user,
      recipient_team_id: recipient.team,
      task_display_mode: 'timeline',
      ...identityFields(identity)
    })

    return {
      appendText: async (markdown: string) => {
        await streamer.append({ markdown_text: markdown })
      },
      updateTask: async (task: SlackTask) => {
        await streamer.append({ chunks: [{ type: 'task_update', ...task }] })
      },
      stop: async (status: SessionStatus) => {
        await streamer.stop({ session_status: status })
      }
    }
  }

  return { ...createChannelPoster(client), setStatus, rename, stream }
}

export type SlackWeb = ReturnType<typeof createSlackWeb>
