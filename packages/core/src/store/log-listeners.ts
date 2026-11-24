import { randomUUIDv7 } from 'node:crypto'
import { z } from 'zod'
import type { LogStore } from '@tanstack/ai-persistence'
import type { Database, DatabaseNotice, TransactionQuery } from './database.ts'

const LOG_CHANNEL = 'harness_log'

const notificationSchema = z.object({ logId: z.string(), from: z.string() })

const notificationPayloadSchema = z
  .string()
  .transform((payload, context) => {
    try {
      const parsed: unknown = JSON.parse(payload)

      return parsed
    } catch {
      context.addIssue({ code: 'custom', message: 'The payload is not JSON.' })

      return z.NEVER
    }
  })
  .pipe(notificationSchema)

function readNotification(payload: string) {
  return notificationPayloadSchema.safeParse(payload).data
}

function reportListenerFailureAsTheLogStoreContractSays(error: unknown) {
  console.error('[log-store] A log listener failed.', error)
}

type ListenerState = { isCalled: boolean; version: Promise<string | null> }

const LOG_VERSION_QUERY = `SELECT concat_ws(
  '|',
  (SELECT row(head, first_seq, deleted)::text FROM log_owner WHERE log_id = $1),
  (SELECT row(max(id), count(*) FILTER (WHERE NOT consumed))::text
   FROM log_offers WHERE log_id = $1)
) AS version`

export function createLogListeners(database: Database) {
  const instanceId = randomUUIDv7()
  const listeners = new Map<string, Map<() => void, ListenerState>>()
  const writesInFlight = new Map<string, number>()
  let stopListening: (() => void) | null = null

  const readVersion = async (logId: string) => {
    try {
      const [row] = await database.query<{ version: string }>(
        'read the version of a log',
        LOG_VERSION_QUERY,
        [logId]
      )

      return row?.version ?? null
    } catch {
      return null
    }
  }

  const callOne = (listener: () => void, state: ListenerState) => {
    state.isCalled = true

    try {
      listener()
    } catch (error) {
      reportListenerFailureAsTheLogStoreContractSays(error)
    }
  }

  const call = (logId: string) => {
    for (const [listener, state] of listeners.get(logId) ?? []) {
      callOne(listener, state)
    }
  }

  const catchUp = async (logId: string) => {
    const uncalled =
      listeners
        .get(logId)
        ?.entries()
        .filter(([, state]) => {
          return !state.isCalled
        })
        .toArray() ?? []

    if (uncalled.length === 0) {
      return
    }

    const current = await readVersion(logId)

    for (const [listener, state] of uncalled) {
      // oxlint-disable-next-line no-await-in-loop -- each listener is checked right after its own version resolves
      const atSubscribe = await state.version
      const isGone = !listeners.get(logId)?.has(listener)
      const hasMoved = current === null || current !== atSubscribe

      if (
        !state.isCalled &&
        !isGone &&
        hasMoved &&
        !writesInFlight.has(logId)
      ) {
        callOne(listener, state)
      }
    }
  }

  const onNotice = (notice: DatabaseNotice) => {
    if (notice.kind !== 'notification') {
      for (const logId of listeners.keys()) {
        if (notice.kind === 'listening') {
          void catchUp(logId)
        } else {
          call(logId)
        }
      }

      return
    }

    const notification = readNotification(notice.payload)

    if (notification && notification.from !== instanceId) {
      call(notification.logId)
    }
  }

  const notificationOf = (logId: string) => {
    return {
      channel: LOG_CHANNEL,
      payload: JSON.stringify({ logId, from: instanceId })
    }
  }

  const writeLocally = async <Result>(
    logId: string,
    write: () => Promise<Result>
  ) => {
    writesInFlight.set(logId, (writesInFlight.get(logId) ?? 0) + 1)

    try {
      return await write()
    } finally {
      const writesLeft = (writesInFlight.get(logId) ?? 1) - 1

      if (writesLeft === 0) {
        writesInFlight.delete(logId)
        void catchUp(logId)
      } else {
        writesInFlight.set(logId, writesLeft)
      }
    }
  }

  return {
    call,
    writeLocally,
    notificationOf,
    notify: async (query: TransactionQuery, logId: string) => {
      const { channel, payload } = notificationOf(logId)
      await query('SELECT pg_notify($1, $2)', [channel, payload])
    },
    subscribe: ({ logId, listener }: Parameters<LogStore['subscribe']>[0]) => {
      const logListeners = listeners.getOrInsertComputed(logId, () => {
        return new Map()
      })
      logListeners.set(listener, {
        isCalled: false,
        version: readVersion(logId)
      })
      stopListening ??= database.listen(LOG_CHANNEL, onNotice)

      return () => {
        logListeners.delete(listener)

        if (logListeners.size === 0) {
          listeners.delete(logId)
        }

        if (listeners.size === 0) {
          stopListening?.()
          stopListening = null
        }
      }
    }
  }
}

export type LogListeners = ReturnType<typeof createLogListeners>
