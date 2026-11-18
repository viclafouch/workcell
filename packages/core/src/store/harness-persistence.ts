import { defineAIPersistence } from '@tanstack/ai-persistence'
import { createPostgresArtifactStore } from './artifact-store.ts'
import { createPostgresBlobStore } from './blob-store.ts'
import type { Database, LogLine } from './database.ts'
import { createPostgresLogStore } from './log-store.ts'
import { createPostgresMetadataStore } from './metadata-store.ts'
import { createPostgresSessionIndexStore } from './session-index-store.ts'

type CreateHarnessPersistenceParams = {
  database: Database
  logger: { info: LogLine; warn: LogLine }
}

export function createHarnessPersistence({
  database,
  logger
}: CreateHarnessPersistenceParams) {
  return defineAIPersistence({
    stores: {
      log: createPostgresLogStore({ database, logger }),
      sessions: createPostgresSessionIndexStore(database),
      metadata: createPostgresMetadataStore(database),
      artifacts: createPostgresArtifactStore(database),
      blobs: createPostgresBlobStore(database)
    }
  })
}
