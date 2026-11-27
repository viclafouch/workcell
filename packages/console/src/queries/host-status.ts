import type { HostEvent } from '@tanstack/ai-harness/client'
import {
  experimental_streamedQuery as streamedQuery,
  queryOptions,
  type QueryClient
} from '@tanstack/react-query'
import { createHostClient } from '#/lib/harness.ts'
import type { HarnessName } from '#/server/console-context.ts'
import { BOT_THREADS_QUERY_KEY } from './bot-threads.ts'
import { CHAT_THREADS_QUERY_KEY } from './chat.ts'
import { FEEDBACK_QUERY_KEY } from './feedback.ts'
import { QUEUE_QUERY_KEY } from './queue.ts'
import { WORKERS_QUERY_KEY } from './workers.ts'

const REFRESHED_LISTS = {
  worker: [WORKERS_QUERY_KEY, FEEDBACK_QUERY_KEY, QUEUE_QUERY_KEY],
  bot: [BOT_THREADS_QUERY_KEY, FEEDBACK_QUERY_KEY, CHAT_THREADS_QUERY_KEY]
} as const satisfies Record<HarnessName, readonly (readonly string[])[]>

const LIST_CHANGES = new Set<HostEvent['type']>([
  'status',
  'session',
  'session-deleted'
])

const FIRST_RECONNECT_DELAY_MS = 1000

const LONGEST_RECONNECT_DELAY_MS = 10_000

export type ThreadStatus = Extract<HostEvent, { type: 'status' }>['status']

export type HostStatus = ReadonlyMap<string, ThreadStatus>

export type HostConnection = 'connecting' | 'open' | 'lost'

const hostConnectionKey = (harness: HarnessName) => {
  return ['host-connection', harness] as const
}

export const getHostConnectionQueryOpts = (harness: HarnessName) => {
  return queryOptions({
    queryKey: hostConnectionKey(harness),
    queryFn: (): HostConnection => {
      return 'connecting'
    },
    staleTime: Infinity,
    gcTime: Infinity
  })
}

class HostStreamClosedError extends Error {
  constructor() {
    super('The host closed its event stream.')
    this.name = 'HostStreamClosedError'
  }
}

type SetConnectionParams = {
  client: QueryClient
  harness: HarnessName
  connection: HostConnection
}

const setConnection = ({
  client,
  harness,
  connection
}: SetConnectionParams) => {
  client.setQueryData(hostConnectionKey(harness), connection)
}

const refreshLists = (client: QueryClient, harness: HarnessName) => {
  for (const queryKey of REFRESHED_LISTS[harness]) {
    void client.invalidateQueries({ queryKey }, { cancelRefetch: false })
  }
}

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

type HostEventsParams = {
  harness: HarnessName
  signal: AbortSignal
  client: QueryClient
}

async function* hostEventsWhileOpen({
  harness,
  signal,
  client
}: HostEventsParams) {
  const hostClient = createHostClient(harness, {
    onOpen: () => {
      const isReconnect =
        client.getQueryData(hostConnectionKey(harness)) === 'lost'
      setConnection({ client, harness, connection: 'open' })

      if (isReconnect) {
        refreshLists(client, harness)
      }
    }
  })

  try {
    for await (const event of hostClient.hostEvents({ signal })) {
      if (LIST_CHANGES.has(event.type)) {
        refreshLists(client, harness)
      }

      yield event
    }
  } catch (error) {
    setConnection({
      client,
      harness,
      connection: signal.aborted ? 'connecting' : 'lost'
    })
    throw error
  }

  if (signal.aborted) {
    setConnection({ client, harness, connection: 'connecting' })

    return
  }

  setConnection({ client, harness, connection: 'lost' })
  throw new HostStreamClosedError()
}

export const getHostStatusQueryOpts = (harness: HarnessName) => {
  return queryOptions({
    queryKey: ['host-status', harness],
    queryFn: streamedQuery({
      streamFn: ({ signal, client }) => {
        return hostEventsWhileOpen({ harness, signal, client })
      },
      reducer: withEvent,
      initialValue: new Map<string, ThreadStatus>()
    }),
    staleTime: Infinity,
    gcTime: 0,
    retry: true,
    retryDelay: (failureCount) => {
      return Math.min(
        FIRST_RECONNECT_DELAY_MS * 2 ** failureCount,
        LONGEST_RECONNECT_DELAY_MS
      )
    }
  })
}
