import { useQuery } from '@tanstack/react-query'
import { getHostStatusQueryOpts } from '#/queries/host-status.ts'
import type { HarnessName } from '#/server/dashboard-context.ts'
import { useIsDocumentVisible } from './use-document-visibility.ts'

export const useHostStatus = (harness: HarnessName) => {
  const isVisible = useIsDocumentVisible()

  return useQuery({ ...getHostStatusQueryOpts(harness), subscribed: isVisible })
}

export const useIsThreadActive = (harness: HarnessName, threadId: string) => {
  const hostStatusQuery = useHostStatus(harness)
  const status = hostStatusQuery.data?.get(threadId)

  return status === 'running' || status === 'waiting'
}
