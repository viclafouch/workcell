import {
  defineBlobStore,
  resolveBlobRange,
  type BlobBody,
  type BlobRange,
  type BlobRecord,
  type BlobStore
} from '@tanstack/ai-persistence'
import type { Database } from './database.ts'

type RecordRow = {
  key: string
  size: number
  etag: string
  content_type: string | null
  custom_metadata: Record<string, string> | null
  created_at: number
  updated_at: number
}

type ObjectRow = RecordRow & { bytes: Buffer }

const RECORD_COLUMNS =
  'key, octet_length(bytes)::bigint AS size, etag, content_type, custom_metadata, created_at, updated_at'

const textDecoder = new TextDecoder()

function toRecord(row: RecordRow): BlobRecord {
  return {
    key: row.key,
    size: row.size,
    etag: row.etag,
    contentType: row.content_type ?? undefined,
    customMetadata: row.custom_metadata ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

async function bytesOf(body: BlobBody) {
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  }

  return new Uint8Array(await new Response(body).arrayBuffer())
}

function contentTypeOf(body: BlobBody, contentType: string | undefined) {
  if (contentType !== undefined) {
    return contentType
  }

  return body instanceof Blob && body.type !== '' ? body.type : null
}

function toObject(row: ObjectRow, range?: BlobRange) {
  const bytes = new Uint8Array(row.bytes)

  return {
    ...toRecord(row),
    ...(range !== undefined && {
      range: resolveBlobRange(row.size, range)
    }),
    body: new Response(bytes).body ?? undefined,
    arrayBuffer: () => {
      return Promise.resolve(Uint8Array.from(bytes).buffer)
    },
    text: () => {
      return Promise.resolve(textDecoder.decode(bytes))
    }
  }
}

export function createPostgresBlobStore(database: Database): BlobStore {
  return defineBlobStore({
    put: async (key, body, options) => {
      const now = Date.now()
      const [row] = await database.query<RecordRow>(
        'write a media blob',
        `INSERT INTO media_blobs (key, bytes, etag, content_type, custom_metadata, created_at, updated_at)
         VALUES ($1, $2, nextval('store_revisions')::text, $3, $4, $5, $5)
         ON CONFLICT (key) DO UPDATE
         SET bytes = EXCLUDED.bytes, etag = EXCLUDED.etag,
             content_type = EXCLUDED.content_type,
             custom_metadata = EXCLUDED.custom_metadata,
             updated_at = EXCLUDED.updated_at
         RETURNING ${RECORD_COLUMNS}`,
        [
          key,
          Buffer.from(await bytesOf(body)),
          contentTypeOf(body, options?.contentType),
          options?.customMetadata === undefined
            ? null
            : JSON.stringify(options.customMetadata),
          now
        ]
      )

      if (row === undefined) {
        throw new Error(`The media blob ${key} was not written.`)
      }

      return toRecord(row)
    },
    get: async (key, options) => {
      const range = options?.range
      const [row] = await database.query<ObjectRow>(
        'read a media blob',
        `SELECT ${RECORD_COLUMNS},
           substring(bytes FROM $2::int + 1 FOR coalesce($3::int, octet_length(bytes))) AS bytes
         FROM media_blobs WHERE key = $1`,
        [key, range?.offset ?? 0, range?.length ?? null]
      )

      return row === undefined ? null : toObject(row, range)
    },
    head: async (key) => {
      const [row] = await database.query<RecordRow>(
        'read the record of a media blob',
        `SELECT ${RECORD_COLUMNS} FROM media_blobs WHERE key = $1`,
        [key]
      )

      return row === undefined ? null : toRecord(row)
    },
    delete: async (key) => {
      await database.query(
        'delete a media blob',
        'DELETE FROM media_blobs WHERE key = $1',
        [key]
      )
    },
    list: async ({ prefix = '', cursor, limit } = {}) => {
      if (limit === 0) {
        return { objects: [], truncated: false }
      }

      const rows = await database.query<RecordRow>(
        'list media blobs',
        `SELECT ${RECORD_COLUMNS} FROM media_blobs
         WHERE starts_with(key, $1) AND ($2::text IS NULL OR key > $2)
         ORDER BY key
         LIMIT $3`,
        [prefix, cursor ?? null, limit === undefined ? null : limit + 1]
      )
      const isTruncated = limit !== undefined && rows.length > limit
      const objects = rows.slice(0, limit).map(toRecord)

      return isTruncated
        ? { objects, cursor: objects.at(-1)?.key, truncated: true }
        : { objects, truncated: false }
    }
  })
}
