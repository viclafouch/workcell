import { z } from 'zod'
import {
  defineLogStore,
  LogConflictError,
  LogTruncatedError,
  NO_OWNER_EPOCH,
  OwnershipLostError,
  type LogStore,
  type OrphanedLog
} from '@tanstack/ai-persistence'
import type { Database, LogLine, TransactionQuery } from './database.ts'
import { createLogListeners, type LogListeners } from './log-listeners.ts'

type LogStoreOptions = {
  database: Database
  logger: { info: LogLine; warn: LogLine }
}

type LogStoreContext = LogStoreOptions & { listeners: LogListeners }

type OwnedLog = { logId: string; epoch: number }

const logRecordSchema = z.looseObject({ type: z.string() })

function assertMs(name: string, value: number, { allowZero = false } = {}) {
  const isValid = allowZero ? value >= 0 : value > 0

  if (!isValid) {
    throw new RangeError(
      `${name} must be ${allowZero ? '0 or more' : 'more than 0'}, got ${value}.`
    )
  }
}

function parseRecord(text: string) {
  return logRecordSchema.parse(JSON.parse(text))
}

function loseOwnership(
  { logger }: Pick<LogStoreContext, 'logger'>,
  { logId, epoch }: OwnedLog
) {
  logger.warn({ logId, epoch }, 'The host lost the ownership of a log.')

  return new OwnershipLostError(logId, epoch)
}

async function lockOwnedLog(
  context: LogStoreContext,
  query: TransactionQuery,
  owned: OwnedLog
) {
  const [row] = await query<{ head: number; first_seq: number }>(
    `SELECT head, first_seq FROM log_owner
     WHERE log_id = $1 AND epoch = $2 AND epoch > 0 AND NOT released
     FOR UPDATE`,
    [owned.logId, owned.epoch]
  )

  if (!row) {
    throw loseOwnership(context, owned)
  }

  return { head: row.head, firstSeq: row.first_seq }
}

async function addOwnerRow(query: TransactionQuery, logId: string) {
  await query(
    'INSERT INTO log_owner (log_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [logId]
  )
}

const EMPTY_LOG_HEAD = 0

const APPEND_QUERY = `WITH owner AS (
  SELECT FROM log_owner WHERE log_id = $1
),
pending AS (
  SELECT input_id FROM log_offers
  WHERE log_id = $1 AND input_id = ANY($5::text[]) AND NOT consumed
  FOR UPDATE
),
moved AS (
  INSERT INTO log_owner (log_id, head)
  SELECT $1, $3::bigint + $4::bigint - 1
  WHERE (SELECT count(*) FROM pending) = cardinality($5::text[])
    AND (EXISTS (SELECT FROM owner) OR ($2::bigint = $9::bigint AND $3::bigint = 1))
  ON CONFLICT (log_id) DO UPDATE SET head = EXCLUDED.head
  WHERE log_owner.epoch = $2::bigint
    AND NOT log_owner.released
    AND log_owner.head = $3::bigint - 1
  RETURNING head
),
inserted AS (
  INSERT INTO log_records (log_id, seq, record)
  SELECT $1, $3::bigint + position - 1, record
  FROM moved CROSS JOIN unnest($6::text[]) WITH ORDINALITY AS batch(record, position)
),
consumed AS (
  UPDATE log_offers SET consumed = TRUE
  WHERE log_id = $1 AND input_id IN (SELECT input_id FROM pending)
    AND EXISTS (SELECT FROM moved)
),
notified AS (
  SELECT pg_notify($7, $8) FROM moved
)
SELECT count(*) AS moved FROM notified`

const APPEND_STATE_QUERY = `SELECT
  (SELECT epoch FROM log_owner WHERE log_id = $1) AS epoch,
  (SELECT released FROM log_owner WHERE log_id = $1) AS released,
  (SELECT head FROM log_owner WHERE log_id = $1) AS head,
  (SELECT count(*) FROM log_offers
   WHERE log_id = $1 AND input_id = ANY($2::text[]) AND NOT consumed) AS pending`

type AppendState = {
  epoch: number | null
  released: boolean | null
  head: number | null
  pending: number
}

type AppendBatch = Parameters<LogStore['append']>[0]

type PendingAppend = AppendBatch & { pendingIds: string[] }

function appendRefusal(
  context: LogStoreContext,
  { logId, epoch, seq, consumes, pendingIds }: PendingAppend,
  state: AppendState | undefined
) {
  const ownerEpoch = state?.epoch ?? null
  const isFenced =
    ownerEpoch === null
      ? epoch !== NO_OWNER_EPOCH
      : ownerEpoch !== epoch || state?.released === true

  if (isFenced) {
    return loseOwnership(context, { logId, epoch })
  }

  if ((state?.head ?? EMPTY_LOG_HEAD) !== seq - 1) {
    return new LogConflictError(logId, seq)
  }

  if ((state?.pending ?? 0) < pendingIds.length) {
    return new TypeError(
      `An input of ${JSON.stringify(consumes)} is not a pending offer of log ${JSON.stringify(logId)}.`
    )
  }

  return null
}

function recordMethods(context: LogStoreContext) {
  const { database, listeners } = context

  const readRefusal = async (append: PendingAppend) => {
    const [state] = await database.query<AppendState>(
      'read the state of a refused append',
      APPEND_STATE_QUERY,
      [append.logId, append.pendingIds]
    )

    return appendRefusal(context, append, state)
  }

  const serializeRecords = async (append: PendingAppend) => {
    try {
      return append.records.map((record) => {
        return JSON.stringify(record)
      })
    } catch (error) {
      const refusal = await readRefusal(append)

      if (refusal) {
        throw refusal
      }

      throw error
    }
  }

  return {
    append: async ({ consumes = [], ...batch }: AppendBatch) => {
      if (batch.records.length === 0 && consumes.length === 0) {
        return
      }

      const append = {
        ...batch,
        consumes,
        pendingIds: [...new Set(consumes)]
      }
      const texts = await serializeRecords(append)
      const { channel, payload } = listeners.notificationOf(append.logId)
      const [outcome] = await database.query<{ moved: number }>(
        'append to a log',
        APPEND_QUERY,
        [
          append.logId,
          append.epoch,
          append.seq,
          append.records.length,
          append.pendingIds,
          texts,
          channel,
          payload,
          NO_OWNER_EPOCH
        ]
      )

      if (!outcome?.moved) {
        throw (
          (await readRefusal(append)) ??
          new LogConflictError(append.logId, append.seq)
        )
      }

      listeners.call(append.logId)
    },
    read: async ({
      logId,
      after = 0,
      limit
    }: Parameters<LogStore['read']>[0]) => {
      const rows = await database.query<{
        first_seq: number
        seq: number | null
        record: string | null
      }>(
        'read a log',
        `SELECT kept.first_seq, records.seq, records.record
         FROM (
           SELECT COALESCE((SELECT first_seq FROM log_owner WHERE log_id = $1), 1) AS first_seq
         ) AS kept
         LEFT JOIN LATERAL (
           SELECT seq, record FROM log_records
           WHERE log_id = $1 AND seq > $2
           ORDER BY seq
           LIMIT $3
         ) AS records ON TRUE`,
        [logId, after, limit ?? null]
      )
      const firstSeq = rows[0]?.first_seq ?? 1

      if (after < firstSeq - 1) {
        throw new LogTruncatedError(logId, firstSeq)
      }

      return rows.flatMap(({ seq, record }) => {
        return seq === null || record === null
          ? []
          : [{ seq, record: parseRecord(record) }]
      })
    }
  }
}

function ownershipMethods(context: LogStoreContext) {
  const { database, logger } = context

  return {
    acquireOwnership: async ({
      logId,
      harness,
      ownerId,
      ttlMs,
      affinity
    }: Parameters<LogStore['acquireOwnership']>[0]) => {
      assertMs('ttlMs', ttlMs)

      const acquired = await database.transaction(
        'acquire a log',
        async (query) => {
          await addOwnerRow(query, logId)
          const [current] = await query<{
            epoch: number
            owner_id: string | null
            released: boolean
            live: boolean
            pinned_elsewhere: boolean
          }>(
            `SELECT epoch, owner_id, released,
               epoch > 0 AND NOT released AND expires_at > now() AS live,
               affinity IS NOT NULL AND affinity IS DISTINCT FROM $2 AND EXISTS (
                 SELECT 1 FROM log_hosts WHERE host_id = affinity AND expires_at > now()
               ) AS pinned_elsewhere
             FROM log_owner WHERE log_id = $1
             FOR UPDATE`,
            [logId, affinity ?? null]
          )

          if (!current) {
            throw new Error(`The owner row of log ${logId} is missing.`)
          }

          const isHeldByOther = current.live && current.owner_id !== ownerId

          if (isHeldByOther || current.pinned_elsewhere) {
            return null
          }

          if (current.live) {
            await query(
              `UPDATE log_owner SET expires_at = now() + $2 * interval '1 millisecond'
               WHERE log_id = $1`,
              [logId, ttlMs]
            )

            return {
              epoch: current.epoch,
              expired: false,
              isNew: false
            }
          }

          const epoch = current.epoch + 1
          await query(
            `UPDATE log_owner
             SET epoch = $5, owner_id = $2, harness = $3,
               expires_at = now() + $4 * interval '1 millisecond',
               released = FALSE, deleted = FALSE, wake_at = NULL
             WHERE log_id = $1`,
            [logId, ownerId, harness, ttlMs, epoch]
          )
          const isExpired =
            current.epoch > NO_OWNER_EPOCH &&
            !current.released &&
            current.owner_id !== ownerId

          return { epoch, expired: isExpired, isNew: true }
        }
      )

      if (acquired === null) {
        return null
      }

      const { epoch, expired, isNew } = acquired

      if (isNew) {
        logger.info({ logId, epoch, expired }, 'The host acquired a log.')
      }

      return expired ? { epoch, expired: true } : { epoch }
    },
    renewOwnership: async ({
      logId,
      ownerId,
      epoch,
      ttlMs
    }: Parameters<LogStore['renewOwnership']>[0]) => {
      assertMs('ttlMs', ttlMs)
      const renewed = await database.query(
        'renew a log',
        `UPDATE log_owner SET expires_at = now() + $4 * interval '1 millisecond'
         WHERE log_id = $1 AND owner_id = $2 AND epoch = $3 AND NOT released
         RETURNING log_id`,
        [logId, ownerId, epoch, ttlMs]
      )

      const isRenewed = renewed.length > 0

      if (!isRenewed) {
        loseOwnership(context, { logId, epoch })
      }

      return isRenewed
    },
    releaseOwnership: async ({
      logId,
      ownerId,
      epoch,
      wakeInMs
    }: Parameters<LogStore['releaseOwnership']>[0]) => {
      if (wakeInMs !== undefined) {
        assertMs('wakeInMs', wakeInMs, { allowZero: true })
      }

      const released = await database.query(
        'release a log',
        `UPDATE log_owner
         SET released = TRUE,
           wake_at = CASE WHEN $4::bigint IS NULL THEN wake_at
             ELSE now() + $4::bigint * interval '1 millisecond' END
         WHERE log_id = $1 AND owner_id = $2 AND epoch = $3 AND NOT released
         RETURNING log_id`,
        [logId, ownerId, epoch, wakeInMs ?? null]
      )

      if (released.length > 0) {
        logger.info({ logId, epoch, wakeInMs }, 'The host released a log.')
      }
    },
    pinToWorkers: async ({
      logId,
      epoch,
      affinity
    }: Parameters<LogStore['pinToWorkers']>[0]) => {
      const pinned = await database.query(
        'pin a log',
        `UPDATE log_owner SET affinity = $3
         WHERE log_id = $1 AND epoch = $2 AND epoch > 0 AND NOT released
         RETURNING log_id`,
        [logId, epoch, affinity]
      )

      if (pinned.length === 0) {
        throw loseOwnership(context, { logId, epoch })
      }
    },
    markHostAlive: async ({
      hostId,
      ttlMs
    }: Parameters<LogStore['markHostAlive']>[0]) => {
      assertMs('ttlMs', ttlMs)
      await database.query(
        'mark a host alive',
        `INSERT INTO log_hosts (host_id, expires_at)
         VALUES ($1, now() + $2 * interval '1 millisecond')
         ON CONFLICT (host_id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
        [hostId, ttlMs]
      )
    },
    listLogsWithoutOwner: async ({
      limit,
      harnesses,
      affinity
    }: Parameters<LogStore['listLogsWithoutOwner']>[0]) => {
      return database.query<OrphanedLog>(
        'list the logs without an owner',
        `WITH due AS (
           SELECT log_id, harness, 'expired' AS reason, expires_at AS due_at
           FROM log_owner
           WHERE epoch > 0 AND NOT released AND expires_at <= now()
           UNION ALL
           SELECT pending.log_id,
             COALESCE(o.harness, (
               SELECT harness FROM log_offers
               WHERE log_id = pending.log_id
               ORDER BY id LIMIT 1
             )),
             'offered', pending.offered_at
           FROM (
             SELECT DISTINCT ON (log_id) log_id, offered_at
             FROM log_offers
             WHERE NOT consumed
             ORDER BY log_id, id
           ) AS pending
           JOIN log_owner AS o USING (log_id)
           WHERE NOT (o.epoch > 0 AND NOT o.released)
           UNION ALL
           SELECT o.log_id, o.harness, 'wake', o.wake_at
           FROM log_owner AS o
           WHERE o.released AND o.wake_at <= now()
             AND NOT EXISTS (
               SELECT 1 FROM log_offers
               WHERE log_id = o.log_id AND NOT consumed
             )
         )
         SELECT due.log_id AS "logId", due.harness, due.reason
         FROM due
         JOIN log_owner AS o USING (log_id)
         WHERE ($1::text[] IS NULL OR due.harness = ANY($1::text[]))
           AND (o.affinity IS NULL
             OR o.affinity = $2
             OR NOT EXISTS (
               SELECT 1 FROM log_hosts AS h
               WHERE h.host_id = o.affinity AND h.expires_at > now()
             ))
         ORDER BY due.due_at
         LIMIT $3`,
        [harnesses ?? null, affinity ?? null, limit]
      )
    }
  }
}

function inputLaneMethods({ database, listeners }: LogStoreContext) {
  return {
    offerInput: async ({
      logId,
      harness,
      inputId,
      record
    }: Parameters<LogStore['offerInput']>[0]) => {
      const encoded = JSON.stringify(record)

      const result = await database.transaction(
        'offer an input',
        async (query) => {
          await addOwnerRow(query, logId)
          const [owner] = await query<{ deleted: boolean }>(
            'SELECT deleted FROM log_owner WHERE log_id = $1 FOR SHARE',
            [logId]
          )

          if (owner?.deleted) {
            return 'deleted'
          }

          const offered = await query(
            `INSERT INTO log_offers (log_id, input_id, harness, record)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (log_id, input_id) DO NOTHING
             RETURNING id`,
            [logId, inputId, harness, encoded]
          )

          if (offered.length === 0) {
            const [previous] = await query<{ record: string }>(
              'SELECT record FROM log_offers WHERE log_id = $1 AND input_id = $2',
              [logId, inputId]
            )

            return previous?.record === encoded ? 'duplicate' : 'conflict'
          }

          await listeners.notify(query, logId)

          return 'offered'
        }
      )

      if (result === 'offered') {
        listeners.call(logId)
      }

      return result
    },
    listOfferedInputs: async ({
      logId
    }: Parameters<LogStore['listOfferedInputs']>[0]) => {
      const rows = await database.query<{
        input_id: string
        record: string
        offered_at: number
      }>(
        'list the offered inputs',
        `SELECT input_id, record,
           floor(extract(epoch FROM offered_at) * 1000)::bigint AS offered_at
         FROM log_offers
         WHERE log_id = $1 AND NOT consumed
         ORDER BY id`,
        [logId]
      )

      return rows.map((row) => {
        return {
          inputId: row.input_id,
          record: parseRecord(row.record),
          offeredAt: row.offered_at
        }
      })
    }
  }
}

function snapshotMethods(context: LogStoreContext) {
  const { database, listeners } = context

  return {
    getSnapshot: async ({ logId }: Parameters<LogStore['getSnapshot']>[0]) => {
      const [snapshot] = await database.query<{
        seq: number
        version: string
        state: string
      }>(
        'read a log snapshot',
        'SELECT seq, version, state FROM log_snapshots WHERE log_id = $1',
        [logId]
      )

      if (!snapshot) {
        return null
      }

      const state: unknown = JSON.parse(snapshot.state)

      return { seq: snapshot.seq, version: snapshot.version, state }
    },
    putSnapshot: async ({
      logId,
      epoch,
      seq,
      version,
      state
    }: Parameters<LogStore['putSnapshot']>[0]) => {
      await database.transaction('save a log snapshot', async (query) => {
        const { head, firstSeq } = await lockOwnedLog(context, query, {
          logId,
          epoch
        })

        if (seq > head) {
          throw new RangeError(
            `Snapshot position ${seq} is after the last position ${head} of log ${JSON.stringify(logId)}.`
          )
        }

        if (seq < firstSeq - 1) {
          throw new RangeError(
            `Snapshot position ${seq} is before position ${firstSeq - 1} of log ${JSON.stringify(logId)}. The log dropped the records before ${firstSeq}.`
          )
        }

        await query(
          `INSERT INTO log_snapshots (log_id, seq, version, state)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (log_id) DO UPDATE
           SET seq = EXCLUDED.seq, version = EXCLUDED.version, state = EXCLUDED.state`,
          [logId, seq, version, JSON.stringify(state)]
        )
      })
    },
    truncate: async ({
      logId,
      epoch,
      beforeSeq
    }: Parameters<LogStore['truncate']>[0]) => {
      await database.transaction('truncate a log', async (query) => {
        const { firstSeq } = await lockOwnedLog(context, query, {
          logId,
          epoch
        })
        const [snapshot] = await query<{ seq: number }>(
          'SELECT seq FROM log_snapshots WHERE log_id = $1',
          [logId]
        )

        if (!snapshot || snapshot.seq < beforeSeq - 1) {
          throw new RangeError(
            `Log ${JSON.stringify(logId)} has no snapshot at position ${beforeSeq - 1} or later, so it keeps the records before ${beforeSeq}.`
          )
        }

        if (beforeSeq <= firstSeq) {
          return
        }

        await query('DELETE FROM log_records WHERE log_id = $1 AND seq < $2', [
          logId,
          beforeSeq
        ])
        await query('UPDATE log_owner SET first_seq = $2 WHERE log_id = $1', [
          logId,
          beforeSeq
        ])
      })
    },
    deleteLog: async ({ logId }: Parameters<LogStore['deleteLog']>[0]) => {
      await database.transaction('delete a log', async (query) => {
        await addOwnerRow(query, logId)
        await query(
          `UPDATE log_owner
           SET head = 0, first_seq = 1, released = TRUE, deleted = TRUE,
             wake_at = NULL, affinity = NULL
           WHERE log_id = $1`,
          [logId]
        )
        await query('DELETE FROM log_records WHERE log_id = $1', [logId])
        await query('DELETE FROM log_offers WHERE log_id = $1', [logId])
        await query('DELETE FROM log_snapshots WHERE log_id = $1', [logId])
        await listeners.notify(query, logId)
      })
      context.logger.info({ logId }, 'The host deleted a log.')
      listeners.call(logId)
    }
  }
}

export function createPostgresLogStore(options: LogStoreOptions): LogStore {
  const listeners = createLogListeners(options.database)
  const context = { ...options, listeners }

  return defineLogStore({
    ...recordMethods(context),
    subscribe: listeners.subscribe,
    ...ownershipMethods(context),
    ...inputLaneMethods(context),
    ...snapshotMethods(context)
  })
}
