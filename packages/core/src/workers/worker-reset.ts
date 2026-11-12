import type { SessionIndexEntry } from '@tanstack/ai-persistence'
import type { Database } from '#core/store/database'
import { createPostgresSessionIndexStore } from '#core/store/session-index-store'
import { WORKER_HARNESS_NAME } from './harness.ts'
import { listedWorkerOf, type ListedWorker } from './live-workers.ts'

const RESET_MARK = ':reset-'

export type WorkerReset = {
  worker: ListedWorker
  resetInputId: string
}

type PlanWorkerResetParams = { database: Database; inputId: string }

type ResetWorkersParams = {
  database: Database
  plan: readonly WorkerReset[]
  destroySandbox: (sandboxId: string) => Promise<void>
}

export async function planWorkerReset({
  database,
  inputId
}: PlanWorkerResetParams): Promise<WorkerReset[]> {
  const { entries } = await createPostgresSessionIndexStore(database).list({
    harness: WORKER_HARNESS_NAME,
    withArchived: true
  })
  const workers = entries.flatMap((entry) => {
    return listedWorkerOf(entry) ?? []
  })
  const resetCount = workers.filter((worker) => {
    return worker.inputId?.startsWith(`${inputId}${RESET_MARK}`) === true
  }).length

  return workers
    .filter((worker) => {
      return worker.inputId === inputId
    })
    .map((worker, index) => {
      return {
        worker,
        resetInputId: `${inputId}${RESET_MARK}${resetCount + index + 1}`
      }
    })
}

async function resetWorker(database: Database, reset: WorkerReset) {
  const { threadId } = reset.worker

  return database.transaction('reset a worker', async (query) => {
    const [row] = await query<{ entry: SessionIndexEntry }>(
      `SELECT entry FROM session_index
       WHERE tenant_id = '' AND thread_id = $1 FOR UPDATE`,
      [threadId]
    )

    if (row === undefined) {
      throw new Error(`The worker of the thread ${threadId} has no entry.`)
    }

    const updatedAt = Date.now()
    const entry: SessionIndexEntry = {
      ...row.entry,
      archived: true,
      updatedAt,
      metadata: { ...row.entry.metadata, inputId: reset.resetInputId }
    }
    await query(
      `UPDATE session_index
       SET entry = $2, updated_at = $3, revision = nextval('store_revisions')
       WHERE tenant_id = '' AND thread_id = $1`,
      [threadId, JSON.stringify(entry), updatedAt]
    )
    await query('DELETE FROM worker_changes WHERE thread_id = $1', [threadId])
    const sandboxes = await query<{ provider_sandbox_id: string }>(
      `DELETE FROM sandbox_instances WHERE thread_id = $1
       RETURNING provider_sandbox_id`,
      [threadId]
    )

    return sandboxes.map(({ provider_sandbox_id }) => {
      return provider_sandbox_id
    })
  })
}

export async function resetWorkers({
  database,
  plan,
  destroySandbox
}: ResetWorkersParams) {
  for (const reset of plan) {
    // oxlint-disable-next-line no-await-in-loop -- the reset stops at the first worker that fails
    const sandboxIds = await resetWorker(database, reset)
    // oxlint-disable-next-line no-await-in-loop -- a worker loses its sandboxes before the next worker resets
    await Promise.all(
      sandboxIds.map(async (sandboxId) => {
        await destroySandbox(sandboxId)
      })
    )
  }
}
