import {
  defineMetadataStore,
  type MetadataStore
} from '@tanstack/ai-persistence'
import { toCompareAndSetResult } from './compare-and-set.ts'
import type { Database } from './database.ts'

type ValueRow = { value: string; revision: string }

const INSERT_VALUE = `INSERT INTO metadata_entries (namespace, key, value, revision)
  VALUES ($1, $2, $3, nextval('store_revisions'))`

function encodeValue(namespace: string, key: string, value: unknown) {
  if (value === null || value === undefined) {
    throw new TypeError(
      `The metadata store keeps no ${String(value)} for (${namespace}, ${key}). Call delete() to clear it.`
    )
  }

  return JSON.stringify(value)
}

export function createPostgresMetadataStore(database: Database): MetadataStore {
  const getVersioned = async (namespace: string, key: string) => {
    const [row] = await database.query<ValueRow>(
      'read a metadata value',
      `SELECT value, revision::text AS revision FROM metadata_entries
       WHERE namespace = $1 AND key = $2`,
      [namespace, key]
    )

    if (!row) {
      return null
    }

    const value: unknown = JSON.parse(row.value)

    return { value, revision: row.revision }
  }

  return defineMetadataStore({
    get: async (namespace, key) => {
      const versioned = await getVersioned(namespace, key)

      return versioned?.value ?? null
    },
    getVersioned,
    set: async (namespace, key, value) => {
      await database.query(
        'write a metadata value',
        `${INSERT_VALUE}
         ON CONFLICT (namespace, key) DO UPDATE
         SET value = EXCLUDED.value, revision = EXCLUDED.revision`,
        [namespace, key, encodeValue(namespace, key, value)]
      )
    },
    setIf: async (namespace, key, value, expectedRevision) => {
      const encoded = encodeValue(namespace, key, value)
      const written =
        expectedRevision === null
          ? await database.query<{ revision: string }>(
              'create a metadata value',
              `${INSERT_VALUE}
               ON CONFLICT (namespace, key) DO NOTHING
               RETURNING revision::text AS revision`,
              [namespace, key, encoded]
            )
          : await database.query<{ revision: string }>(
              'change a metadata value',
              `UPDATE metadata_entries
               SET value = $3, revision = nextval('store_revisions')
               WHERE namespace = $1 AND key = $2 AND revision::text = $4
               RETURNING revision::text AS revision`,
              [namespace, key, encoded, expectedRevision]
            )

      return toCompareAndSetResult(written)
    },
    delete: async (namespace, key) => {
      await database.query(
        'delete a metadata value',
        'DELETE FROM metadata_entries WHERE namespace = $1 AND key = $2',
        [namespace, key]
      )
    }
  })
}
