import type { SlackAdapter } from '@chat-adapter/slack'
import { chatThreadContexts } from '@workcell/chat'
import { SLACK_CHAT_MARK } from './slack-chat-mark.ts'

type SlackWorkspace = { name: string; url: string }

type SlackConsoleChatParams = {
  adapter: SlackAdapter
}

export function slackConsoleChat({ adapter }: SlackConsoleChatParams) {
  const contexts = chatThreadContexts(adapter)
  let workspace: Promise<SlackWorkspace | null> | null = null

  const readWorkspace = async (): Promise<SlackWorkspace | null> => {
    try {
      const { team, url } = await adapter.webClient.auth.test()

      return team === undefined || url === undefined
        ? null
        : { name: team, url }
    } catch {
      workspace = null

      return null
    }
  }

  const workspaceOf = () => {
    workspace ??= readWorkspace()

    return workspace
  }

  const describe = async (threadId: string) => {
    const [context, slackWorkspace] = await Promise.all([
      contexts.describe(threadId),
      workspaceOf()
    ])

    if (slackWorkspace === null) {
      return context
    }

    const { channel, threadTs } = adapter.decodeThreadId(threadId)

    return {
      ...context,
      place: {
        ...context.place,
        url: new URL(`archives/${channel}`, slackWorkspace.url).href
      },
      workspace: slackWorkspace,
      threadUrl: new URL(
        `archives/${channel}/p${threadTs.replace('.', '')}`,
        slackWorkspace.url
      ).href
    }
  }

  return { ...SLACK_CHAT_MARK, bot: contexts.bot, describe }
}
