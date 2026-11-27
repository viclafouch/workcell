import { queryOptions } from '@tanstack/react-query'
import { getQueue } from '#/server/queue.functions.ts'

export const QUEUE_QUERY_KEY = ['queue'] as const

export const getQueueQueryOpts = () => {
  return queryOptions({
    queryKey: QUEUE_QUERY_KEY,
    queryFn: () => {
      return getQueue()
    }
  })
}
