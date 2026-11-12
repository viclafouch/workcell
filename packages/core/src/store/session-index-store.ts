import {
  defineSessionIndexStore,
  type SessionIndexEntry,
  type SessionIndexKey,
  type SessionIndexStore
} from '@tanstack/ai-persistence'
import { toCompareAndSetResult } from './compare-and-set.ts'
import type { Database } from './database.ts'

type VersionedRow = { entry: SessionIndexEntry; revision: string }

const CURSOR_SEPARATOR = ':'

const INSERT_ENTRY = `INSERT INTO session_index (tenant_id, thread_id, updated_at, revision, entry)
  VALUES ($1, $2, $3, nextval('store_revisions'), $4)`

function parseCursor(cursor: string) {
  const split = cursor.indexOf(CURSOR_SEPARATOR)
  const updatedAt = Number(cursor.slice(0, split))

  if (split <= 0 || !Number.isFinite(updatedAt)) {
    throw new Error(`The session index cursor ${cursor} is not valid.`)
  }

  return { updatedAt, threadId: cursor.slice(split + 1) }
}

function toKeyValues({ tenantId, threadId }: SessionIndexKey) {
  return [tenantId ?? '', threadId]
}

function toEntryValues(entry: SessionIndexEntry) {
  return [...toKeyValues(entry), entry.updatedAt, JSON.stringify(entry)]
}

export function createPostgresSessionIndexStore(
  database: Database
): SessionIndexStore {
  const getVersioned = async (key: SessionIndexKey) => {
    const [row] = await database.query<VersionedRow>(
      'read a session index entry',
      `SELECT entry, revision::text AS revision FROM session_index
       WHERE tenant_id = $1 AND thread_id = $2`,
      toKeyValues(key)
    )

    return row
  }

  return defineSessionIndexStore({
    get: async (key) => {
      const versioned = await getVersioned(key)

      return versioned?.entry
    },
    getVersioned,
    upsert: async (entry) => {
      await database.query(
        'write a session index entry',
        `${INSERT_ENTRY}
         ON CONFLICT (tenant_id, thread_id) DO UPDATE
         SET updated_at = EXCLUDED.updated_at, revision = EXCLUDED.revision, entry = EXCLUDED.entry`,
        toEntryValues(entry)
      )
    },
    upsertIf: async ({ entry, revision }) => {
      const written =
        revision === null
          ? await database.query<{ revision: string }>(
              'create a session index entry',
              `${INSERT_ENTRY}
               ON CONFLICT (tenant_id, thread_id) DO NOTHING
               RETURNING revision::text AS revision`,
              toEntryValues(entry)
            )
          : await database.query<{ revision: string }>(
              'change a session index entry',
              `UPDATE session_index
               SET updated_at = $3, revision = nextval('store_revisions'), entry = $4
               WHERE tenant_id = $1 AND thread_id = $2 AND revision::text = $5
               RETURNING revision::text AS revision`,
              [...toEntryValues(entry), revision]
            )
      return toCompareAndSetResult(written)
    },
    list: async (options = {}) => {
      const after =
        options.cursor === undefined ? undefined : parseCursor(options.cursor)
      const metadata =
        Object.keys(options.metadata ?? {}).length > 0
          ? JSON.stringify(options.metadata)
          : null
      const rows = await database.query<{ entry: SessionIndexEntry }>(
        'list the session index',
        `SELECT entry FROM session_index
         WHERE tenant_id = $1
           AND ($2::text IS NULL
             OR entry->'members' @> jsonb_build_array(jsonb_build_object('userId', $2::text)))
           AND (NOT $3::boolean
             OR ($4::text IS NULL AND entry->>'parentThreadId' IS NULL)
             OR entry->>'parentThreadId' = $4::text)
           AND ($5::text IS NULL OR strpos(lower(entry->>'title'), lower($5::text)) > 0)
           AND ($6::text IS NULL OR entry->>'harness' = $6::text)
           AND ($7::jsonb IS NULL OR entry->'metadata' @> $7::jsonb)
           AND ($8::boolean OR entry->'archived' IS DISTINCT FROM 'true'::jsonb)
           AND ($9::bigint IS NULL
             OR updated_at < $9::bigint
             OR (updated_at = $9::bigint AND thread_id COLLATE "C" > $10::text))
         ORDER BY updated_at DESC, thread_id COLLATE "C"
         LIMIT $11`,
        [
          options.tenantId ?? '',
          options.memberId ?? null,
          options.parentThreadId !== undefined,
          options.parentThreadId ?? null,
          options.search ?? null,
          options.harness ?? null,
          metadata,
          options.withArchived === true,
          after?.updatedAt ?? null,
          after?.threadId ?? null,
          options.limit === undefined ? null : options.limit + 1
        ]
      )
      const entries = rows.map(({ entry }) => {
        return entry
      })
      const page =
        options.limit === undefined ? entries : entries.slice(0, options.limit)
      const last = page.at(-1)
      const isTruncated = entries.length > page.length && last !== undefined

      return isTruncated
        ? {
            entries: page,
            cursor: `${last.updatedAt}${CURSOR_SEPARATOR}${last.threadId}`,
            truncated: true
          }
        : { entries: page }
    },
    delete: async (key) => {
      await database.query(
        'delete a session index entry',
        'DELETE FROM session_index WHERE tenant_id = $1 AND thread_id = $2',
        toKeyValues(key)
      )
    }
  })
}
