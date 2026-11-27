import { useQuery } from '@tanstack/react-query'
import { getHostStatusQueryOpts } from '#/queries/host-status.ts'
import type { HarnessName } from '#/server/console-context.ts'

export const useHostStatus = (harness: HarnessName) => {
  return useQuery(getHostStatusQueryOpts(harness))
}

export const useIsThreadActive = (harness: HarnessName, threadId: string) => {
  const hostStatusQuery = useHostStatus(harness)
  const status = hostStatusQuery.data?.get(threadId)

  return status === 'running' || status === 'waiting'
}
