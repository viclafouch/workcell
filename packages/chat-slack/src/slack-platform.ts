import {
  cardToBlockKit,
  cardToFallbackText,
  type SlackAdapter
} from '@chat-adapter/slack'
import type {
  ChatIdentity,
  ChatMessage,
  IdentityPost,
  PlatformExtras,
  SessionStatus
} from '@workcell/chat'

export const SLACK_SECRET_NAMES = [
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN'
] as const

const SLACK_STATUS_LINE_MAX_LENGTH = 50

export const SLACK_CARD_LIMITS = {
  tables: 1,
  charts: 2,
  fields: 10,
  tableRows: 100,
  tableColumns: 20,
  chartTitle: 50,
  chartLabel: 20,
  chartSeries: 12,
  chartPoints: 20
}

function shownStatusLine(line: string) {
  const characters = Array.from(
    new Intl.Segmenter().segment(line),
    ({ segment }) => {
      return segment
    }
  )

  return characters.length > SLACK_STATUS_LINE_MAX_LENGTH
    ? `${characters.slice(0, SLACK_STATUS_LINE_MAX_LENGTH - 1).join('')}…`
    : line
}

function contentOf(message: ChatMessage) {
  return 'card' in message
    ? {
        text: message.fallbackText ?? cardToFallbackText(message.card),
        blocks: cardToBlockKit(message.card)
      }
    : { markdown_text: message.markdown }
}

export function slackPlatform(adapter: SlackAdapter): PlatformExtras {
  const postAs = async ({ target, message, identity }: IdentityPost) => {
    const { channel, threadTs } = adapter.decodeThreadId(
      'channelId' in target ? target.channelId : target.threadId
    )
    const post = {
      channel,
      thread_ts: threadTs || undefined,
      ...contentOf(message),
      username: identity.name,
      icon_url: identity.iconUrl,
      unfurl_links: false,
      unfurl_media: false
    }
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- chat.postMessage of the Slack Web API takes no target origin
    const { ts } = await adapter.webClient.chat.postMessage(post)

    if (ts === undefined) {
      throw new Error(`Slack gave no timestamp to the post in ${channel}.`)
    }

    return {
      threadId: adapter.encodeThreadId({ channel, threadTs: threadTs || ts }),
      messageId: ts
    }
  }

  const setStatus = async (
    threadId: string,
    status: SessionStatus,
    identity?: ChatIdentity
  ) => {
    const { channel, threadTs } = adapter.decodeThreadId(threadId)
    await adapter.webClient.apiCall('agents.sessions.setStatus', {
      channel_id: channel,
      thread_ts: threadTs,
      status,
      username: identity?.name,
      icon_url: identity?.iconUrl
    })
  }

  const setStatusLine = async (
    threadId: string,
    line: string,
    identity?: ChatIdentity
  ) => {
    const { channel, threadTs } = adapter.decodeThreadId(threadId)
    const shown = shownStatusLine(line)
    await adapter.webClient.apiCall(
      'assistant.threads.setStatus',
      shown === ''
        ? { channel_id: channel, thread_ts: threadTs, status: shown }
        : {
            channel_id: channel,
            thread_ts: threadTs,
            status: shown,
            loading_messages: [shown],
            username: identity?.name,
            icon_url: identity?.iconUrl
          }
    )
  }

  return { postAs, setStatus, setStatusLine }
}
