import type { Database } from './database.ts'

type SavedChanges = {
  branch: string | undefined
  bundle: Uint8Array
}

type SavedChangesRow = { branch: string | null; bundle: Buffer }

export function createWorkerChangesStore(database: Database) {
  return {
    save: async (threadId: string, { branch, bundle }: SavedChanges) => {
      await database.query(
        'save the changes of a worker',
        `INSERT INTO worker_changes (thread_id, branch, bundle)
         VALUES ($1, $2, $3)
         ON CONFLICT (thread_id) DO UPDATE
         SET branch = EXCLUDED.branch, bundle = EXCLUDED.bundle, saved_at = now()`,
        [threadId, branch ?? null, Buffer.from(bundle)]
      )
    },
    load: async (threadId: string): Promise<SavedChanges | undefined> => {
      const [row] = await database.query<SavedChangesRow>(
        'load the changes of a worker',
        'SELECT branch, bundle FROM worker_changes WHERE thread_id = $1',
        [threadId]
      )

      if (!row) {
        return undefined
      }

      return {
        branch: row.branch ?? undefined,
        bundle: new Uint8Array(row.bundle)
      }
    },
    remove: async (threadId: string) => {
      await database.query(
        'delete the changes of a worker',
        'DELETE FROM worker_changes WHERE thread_id = $1',
        [threadId]
      )
    }
  }
}
