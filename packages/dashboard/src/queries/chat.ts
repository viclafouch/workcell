import {
  queryOptions,
  skipToken,
  type QueryClient
} from '@tanstack/react-query'
import { getChatMarks, getChatThread } from '#/server/chat.functions.ts'

export const CHAT_THREADS_QUERY_KEY = ['chat-threads'] as const

const CHAT_THREAD_STALE_TIME_MS = 60_000

export const getChatMarksQueryOpts = () => {
  return queryOptions({
    queryKey: ['chat-marks'],
    queryFn: () => {
      return getChatMarks()
    },
    staleTime: Infinity
  })
}

export const getChatThreadQueryOpts = (threadId: string | null) => {
  return queryOptions({
    queryKey: [...CHAT_THREADS_QUERY_KEY, threadId],
    queryFn:
      threadId === null
        ? skipToken
        : () => {
            return getChatThread({ data: { threadId } })
          },
    staleTime: CHAT_THREAD_STALE_TIME_MS
  })
}

export const preloadChatThread = async (
  queryClient: QueryClient,
  threadId: string
) => {
  try {
    return await queryClient.query(getChatThreadQueryOpts(threadId))
  } catch {
    return null
  }
}
