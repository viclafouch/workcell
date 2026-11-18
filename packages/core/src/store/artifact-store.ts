import {
  defineArtifactStore,
  type ArtifactRecord,
  type ArtifactStore
} from '@tanstack/ai-persistence'
import type { Database } from './database.ts'

type RecordRow = { record: ArtifactRecord }

const SNAPSHOT_ORDER = 'ORDER BY created_at, artifact_id'

export function createPostgresArtifactStore(
  database: Database
): ArtifactStore {
  const listWhere = async (name: string, column: string, value: string) => {
    const rows = await database.query<RecordRow>(
      name,
      `SELECT record FROM media_artifacts WHERE ${column} = $1 ${SNAPSHOT_ORDER}`,
      [value]
    )

    return rows.map(({ record }) => {
      return record
    })
  }

  return defineArtifactStore({
    save: async (record) => {
      await database.query(
        'save a media artifact',
        `INSERT INTO media_artifacts (artifact_id, run_id, thread_id, created_at, record)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (artifact_id) DO UPDATE
         SET run_id = EXCLUDED.run_id, thread_id = EXCLUDED.thread_id,
             created_at = EXCLUDED.created_at, record = EXCLUDED.record`,
        [
          record.artifactId,
          record.runId,
          record.threadId,
          record.createdAt,
          JSON.stringify(record)
        ]
      )
    },
    get: async (artifactId) => {
      const [row] = await database.query<RecordRow>(
        'read a media artifact',
        'SELECT record FROM media_artifacts WHERE artifact_id = $1',
        [artifactId]
      )

      return row?.record ?? null
    },
    list: (runId) => {
      return listWhere('list the media artifacts of a run', 'run_id', runId)
    },
    listForThread: (threadId) => {
      return listWhere(
        'list the media artifacts of a thread',
        'thread_id',
        threadId
      )
    },
    delete: async (artifactId) => {
      await database.query(
        'delete a media artifact',
        'DELETE FROM media_artifacts WHERE artifact_id = $1',
        [artifactId]
      )
    },
    deleteForRun: async (runId) => {
      await database.query(
        'delete the media artifacts of a run',
        'DELETE FROM media_artifacts WHERE run_id = $1',
        [runId]
      )
    }
  })
}
