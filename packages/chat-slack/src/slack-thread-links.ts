import type { SlackAdapter } from '@chat-adapter/slack'
import { threadOf } from '@workcell/chat'
import type { FeedbackOptions } from '@workcell/core'

const SLACK_THREAD_PREFIX = 'slack:'

type SlackThreadLinksParams = {
  adapter: SlackAdapter
  workspaceUrl: string
}

export function slackThreadLinks({
  adapter,
  workspaceUrl
}: SlackThreadLinksParams): NonNullable<FeedbackOptions['threadLink']> {
  return ({ threadId, metadata }) => {
    const chatThreadId = threadOf(metadata) ?? threadId

    if (!chatThreadId.startsWith(SLACK_THREAD_PREFIX)) {
      return
    }

    const { channel, threadTs } = adapter.decodeThreadId(chatThreadId)

    return new URL(
      `archives/${channel}/p${threadTs.replace('.', '')}`,
      workspaceUrl
    ).href
  }
}
