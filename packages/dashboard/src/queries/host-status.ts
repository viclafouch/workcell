import type { HostEvent } from '@tanstack/ai-harness/client'
import {
  experimental_streamedQuery as streamedQuery,
  queryOptions,
  type QueryClient
} from '@tanstack/react-query'
import { createHostClient } from '#/lib/harness.ts'
import type { HarnessName } from '#/server/dashboard-context.ts'
import { FEEDBACK_QUERY_KEY } from './feedback.ts'
import { WORKERS_QUERY_KEY } from './workers.ts'

const REFRESHED_ON_STATUS = [WORKERS_QUERY_KEY, FEEDBACK_QUERY_KEY]

export type ThreadStatus = Extract<HostEvent, { type: 'status' }>['status']

export type HostStatus = ReadonlyMap<string, ThreadStatus>

const withEvent = (status: HostStatus, event: HostEvent): HostStatus => {
  if (event.type === 'status') {
    return new Map(status).set(event.threadId, event.status)
  }

  if (event.type === 'session-deleted') {
    const next = new Map(status)
    next.delete(event.threadId)

    return next
  }

  return status
}

async function* refreshingWorkers(
  events: AsyncIterable<HostEvent>,
  client: QueryClient
) {
  for await (const event of events) {
    if (event.type === 'status') {
      for (const queryKey of REFRESHED_ON_STATUS) {
        void client.invalidateQueries(
          { queryKey, exact: true },
          { cancelRefetch: false }
        )
      }
    }

    yield event
  }
}

export const getHostStatusQueryOpts = (harness: HarnessName) => {
  return queryOptions({
    queryKey: ['host-status', harness],
    queryFn: streamedQuery({
      streamFn: ({ signal, client }) => {
        return refreshingWorkers(
          createHostClient(harness).hostEvents({ signal }),
          client
        )
      },
      reducer: withEvent,
      initialValue: new Map<string, ThreadStatus>()
    }),
    staleTime: Infinity,
    gcTime: 0,
    retry: true
  })
}
