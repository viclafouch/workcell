import { queryOptions } from '@tanstack/react-query'
import { getWorkerDiff, listWorkers } from '#/server/workers.functions.ts'

export const WORKERS_QUERY_KEY = ['workers'] as const

export const listWorkersQueryOpts = () => {
  return queryOptions({
    queryKey: WORKERS_QUERY_KEY,
    queryFn: () => {
      return listWorkers()
    }
  })
}

export const getWorkerDiffQueryOpts = (threadId: string) => {
  return queryOptions({
    queryKey: [...WORKERS_QUERY_KEY, threadId, 'diff'],
    queryFn: () => {
      return getWorkerDiff({ data: { threadId } })
    },
    staleTime: 0,
    enabled: false
  })
}
