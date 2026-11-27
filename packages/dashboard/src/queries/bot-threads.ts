import type { SessionIndexEntry } from '@tanstack/ai-persistence'
import { queryOptions } from '@tanstack/react-query'
import { createHostClient } from '#/lib/harness.ts'

const BOT_THREADS_PAGE = 20

export const BOT_THREADS_QUERY_KEY = ['bot-threads'] as const

export const titleOfThread = ({ title }: Pick<SessionIndexEntry, 'title'>) => {
  return title ?? 'Untitled thread'
}

export const listBotThreadsQueryOpts = () => {
  return queryOptions({
    queryKey: BOT_THREADS_QUERY_KEY,
    queryFn: async () => {
      const page = await createHostClient('bot').sessions.list({
        limit: BOT_THREADS_PAGE
      })

      return page.entries
    }
  })
}
