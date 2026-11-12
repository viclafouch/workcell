import type { AnyTextAdapter, ChatMiddleware, ModelMessage } from '@tanstack/ai'
import {
  conversationSummarizer,
  summarizeOldest,
  withCompaction
} from '@tanstack/ai-compaction'
import { createExtensionPoint, definePlugin } from '@tanstack/ai-harness'

const COMPACTION_PLUGIN = 'workcell/durable-compaction'

const COMPACT_AT_TOKENS = 160_000

const KEPT_RECENT_TOKENS = 20_000

const FIRST_USER_MESSAGE_HEADING =
  'The first user message of the session, word for word:'

export const SummaryMiddleware = createExtensionPoint<ChatMiddleware>(
  'workcell/summary-middleware'
)

function textOf({ content }: ModelMessage) {
  if (typeof content === 'string') {
    return content
  }

  return (content ?? [])
    .flatMap((part) => {
      return part.type === 'text' ? [part.content] : []
    })
    .join('\n')
}

type KeepFirstUserMessageParams = {
  messages: ModelMessage[]
  previousDetails?: string
}

function keepFirstUserMessage({
  messages,
  previousDetails
}: KeepFirstUserMessageParams) {
  if (previousDetails !== undefined) {
    return previousDetails
  }

  const firstUserMessage = messages.find(({ role }) => {
    return role === 'user'
  })

  return firstUserMessage === undefined
    ? undefined
    : `${FIRST_USER_MESSAGE_HEADING}\n${textOf(firstUserMessage)}`
}

export function durableCompaction(compactionAdapter: AnyTextAdapter) {
  return definePlugin({
    name: COMPACTION_PLUGIN,
    setup: (setupContext) => {
      return {
        middleware: [
          withCompaction({
            maxTokens: COMPACT_AT_TOKENS,
            countTokens: 'usage',
            durable: true,
            strategy: summarizeOldest({
              keepRecentTokens: KEPT_RECENT_TOKENS,
              summarize: (messages, input) => {
                return conversationSummarizer({
                  adapter: compactionAdapter,
                  details: keepFirstUserMessage,
                  middleware: setupContext.collect(SummaryMiddleware)
                })(messages, input)
              }
            })
          })
        ]
      }
    }
  })
}
