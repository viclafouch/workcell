import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { chatAdapterOf } from '#/lib/chat-input.ts'
import type { ChatThreadDetails } from './console-context.ts'

const threadInputSchema = z.object({ threadId: z.string().min(1) })

export const getChatMarks = createServerFn({ method: 'GET' }).handler(
  async ({ context }) => {
    return Promise.all(
      (context.chats ?? []).map(async ({ adapter, name, iconUrl, bot }) => {
        const person = await bot?.().catch((error: unknown) => {
          context.logger.error({ error, adapter }, 'The chat gave no bot.')

          return null
        })

        return { adapter, name, iconUrl, bot: person ?? null }
      })
    )
  }
)

export const getChatThread = createServerFn({ method: 'GET' })
  .validator(threadInputSchema)
  .handler(async ({ context, data }): Promise<ChatThreadDetails | null> => {
    const adapter = chatAdapterOf(data.threadId)
    const chat = context.chats?.find((candidate) => {
      return candidate.adapter === adapter
    })

    if (chat?.describe === undefined) {
      return null
    }

    try {
      return await chat.describe(data.threadId)
    } catch (error) {
      context.logger.error(
        { error, threadId: data.threadId },
        'The chat did not describe the thread.'
      )

      return null
    }
  })
