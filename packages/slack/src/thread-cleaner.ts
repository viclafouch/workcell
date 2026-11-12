import { z } from 'zod'
import { webApi } from '@slack/bolt'
import { toBoltLogger } from './bolt-logger.ts'
import type { SlackThread } from './channel-poster.ts'
import { WEB_API_OPTIONS, type RateLimitedLogger } from './slack-web.ts'

const REPLIES_PAGE_SIZE = 200

const repliesPageSchema = z.object({
  messages: z
    .array(z.looseObject({ ts: z.string(), bot_id: z.string().optional() }))
    .default([])
})

type CreateThreadCleanerParams = {
  botToken: string
  logger: RateLimitedLogger
}

type DeleteMessageParams = { channel: string; ts: string }

export function createThreadCleaner({
  botToken,
  logger
}: CreateThreadCleanerParams) {
  const slackLogger = logger.child({ module: 'slack' })
  const client = new webApi.WebClient(botToken, {
    ...WEB_API_OPTIONS,
    logger: toBoltLogger(slackLogger)
  })
  client.on(webApi.WebClientEvent.RATE_LIMITED, (retryAfterSeconds) => {
    slackLogger.warn(
      { retryAfterSeconds },
      'slack rate limits the thread cleaner'
    )
  })

  const botMessagesOf = async ({ channel, threadTs }: SlackThread) => {
    const { bot_id: botId } = await client.auth.test()
    const timestamps: string[] = []

    for await (const page of client.paginate('conversations.replies', {
      channel,
      ts: threadTs,
      limit: REPLIES_PAGE_SIZE
    })) {
      for (const message of repliesPageSchema.parse(page).messages) {
        if (botId !== undefined && message.bot_id === botId) {
          timestamps.push(message.ts)
        }
      }
    }

    return timestamps
  }

  const deleteMessage = async ({ channel, ts }: DeleteMessageParams) => {
    await client.chat.delete({ channel, ts })
  }

  return { botMessagesOf, deleteMessage }
}

export type ThreadCleaner = ReturnType<typeof createThreadCleaner>
