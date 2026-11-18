import { randomUUIDv7 } from 'node:crypto'
import { mimeTypeOf } from '@tanstack/ai-harness/media'
import { createPostgresBlobStore } from './blob-store.ts'
import type { Database } from './database.ts'

const SENT_FILE_PREFIX = 'sent-files'

type PutSentFileParams = {
  threadId: string
  name: string
  bytes: Uint8Array
}

export function createSentFileStore(database: Database) {
  const blobs = createPostgresBlobStore(database)

  return {
    put: async ({ threadId, name, bytes }: PutSentFileParams) => {
      const key = `${SENT_FILE_PREFIX}/${threadId}/${randomUUIDv7()}`
      await blobs.put(key, bytes, { contentType: mimeTypeOf(name) })

      return key
    },
    take: async (key: string) => {
      const blob = await blobs.get(key)

      if (blob === null) {
        return null
      }

      const bytes = new Uint8Array(await blob.arrayBuffer())
      await blobs.delete(key)

      return bytes
    }
  }
}

export type SentFileStore = ReturnType<typeof createSentFileStore>
