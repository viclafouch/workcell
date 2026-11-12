import { defineSandboxInstanceStore } from '@tanstack/ai-sandbox'
import type { Database } from './database.ts'

type SandboxInstanceRow = {
  key: string
  provider: string
  provider_sandbox_id: string
  latest_snapshot_id: string | null
  thread_id: string
  latest_run_id: string | null
  updated_at: number
}

function toRecord(row: SandboxInstanceRow) {
  return {
    key: row.key,
    provider: row.provider,
    providerSandboxId: row.provider_sandbox_id,
    threadId: row.thread_id,
    updatedAt: row.updated_at,
    ...(row.latest_snapshot_id === null
      ? {}
      : { latestSnapshotId: row.latest_snapshot_id }),
    ...(row.latest_run_id === null ? {} : { latestRunId: row.latest_run_id })
  }
}

export function createSandboxInstanceStore(database: Database) {
  return defineSandboxInstanceStore({
    get: async (key) => {
      const [row] = await database.query<SandboxInstanceRow>(
        'read a sandbox instance',
        `SELECT key, provider, provider_sandbox_id, latest_snapshot_id, thread_id, latest_run_id, updated_at
         FROM sandbox_instances WHERE key = $1`,
        [key]
      )

      return row === undefined ? null : toRecord(row)
    },
    upsert: async (record) => {
      await database.query(
        'write a sandbox instance',
        `INSERT INTO sandbox_instances
           (key, provider, provider_sandbox_id, latest_snapshot_id, thread_id, latest_run_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (key) DO UPDATE SET
           provider = EXCLUDED.provider,
           provider_sandbox_id = EXCLUDED.provider_sandbox_id,
           latest_snapshot_id = EXCLUDED.latest_snapshot_id,
           thread_id = EXCLUDED.thread_id,
           latest_run_id = EXCLUDED.latest_run_id,
           updated_at = EXCLUDED.updated_at`,
        [
          record.key,
          record.provider,
          record.providerSandboxId,
          record.latestSnapshotId ?? null,
          record.threadId,
          record.latestRunId ?? null,
          record.updatedAt
        ]
      )
    },
    delete: async (key) => {
      await database.query(
        'delete a sandbox instance',
        'DELETE FROM sandbox_instances WHERE key = $1',
        [key]
      )
    }
  })
}
