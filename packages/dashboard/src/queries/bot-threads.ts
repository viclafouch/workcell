import { queryOptions } from '@tanstack/react-query'
import { createHostClient } from '#/lib/harness.ts'

const BOT_THREADS_PAGE = 20

export const listBotThreadsQueryOpts = () => {
  return queryOptions({
    queryKey: ['bot-threads'],
    queryFn: async () => {
      const page = await createHostClient('bot').sessions.list({
        limit: BOT_THREADS_PAGE
      })

      return page.entries
    }
  })
}
