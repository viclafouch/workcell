import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Database } from '#/store/database.ts'
import { createSandboxInstanceStore } from '#/store/sandbox-instance-store.ts'
import { createPostgresSessionIndexStore } from '#/store/session-index-store.ts'
import { createWorkerChangesStore } from '#/store/worker-changes-store.ts'
import {
  createMigratedDatabase,
  openTestDatabase
} from '#/testing/test-database.ts'
import { WORKER_HARNESS_NAME } from '#/workers/harness.ts'
import { planWorkerReset, resetWorkers } from '#/workers/worker-reset.ts'

let database: Database

async function addWorker(
  threadId: string,
  inputId: string,
  { archived = false } = {}
) {
  await createPostgresSessionIndexStore(database).upsert({
    threadId,
    harness: WORKER_HARNESS_NAME,
    members: [{ userId: 'test-starter', role: 'owner' }],
    createdAt: 1,
    updatedAt: 1,
    archived,
    metadata: {
      name: 'Alpha',
      task: 'Fix the ticket.',
      repository: 'acme/app',
      subject: 'TASK-1',
      branch: 'task-1-fix',
      inputId,
      slackThreadTs: '1.2'
    }
  })
}

async function readEntry(threadId: string) {
  return createPostgresSessionIndexStore(database).get({ threadId })
}

describe('the reset of the workers of an input', () => {
  beforeAll(async () => {
    database = openTestDatabase(await createMigratedDatabase())
  })

  afterAll(async () => {
    await database.close()
  })

  it('plans each live worker of the input under the next reset input id', async () => {
    await addWorker('planned-worker', 'planned-input')
    await addWorker('planned-old-worker', 'planned-input:reset-1', {
      archived: true
    })
    await addWorker('planned-other-worker', 'another-input')

    expect(
      await planWorkerReset({ database, inputId: 'planned-input' })
    ).toMatchObject([
      {
        worker: {
          threadId: 'planned-worker',
          name: 'Alpha',
          slackThreadTs: '1.2'
        },
        resetInputId: 'planned-input:reset-2'
      }
    ])
  })

  it('archives the worker under its reset input id, and forgets its changes and its sandboxes', async () => {
    await addWorker('reset-worker', 'reset-input')
    await createWorkerChangesStore(database).save('reset-worker', {
      branch: 'task-1-fix',
      bundle: new TextEncoder().encode('saved bundle')
    })
    await createSandboxInstanceStore(database).upsert({
      key: 'app:reset-worker',
      provider: 'docker',
      providerSandboxId: 'container-1',
      threadId: 'reset-worker',
      updatedAt: 1
    })
    const destroySandbox = vi.fn(async () => {})
    const plan = await planWorkerReset({ database, inputId: 'reset-input' })

    await resetWorkers({ database, plan, destroySandbox })

    expect(await readEntry('reset-worker')).toMatchObject({
      archived: true,
      metadata: { inputId: 'reset-input:reset-1', branch: 'task-1-fix' }
    })
    expect(
      await createWorkerChangesStore(database).load('reset-worker')
    ).toBeUndefined()
    expect(
      await createSandboxInstanceStore(database).get('app:reset-worker')
    ).toBeNull()
    expect(destroySandbox).toHaveBeenCalledExactlyOnceWith('container-1')
    expect(
      await planWorkerReset({ database, inputId: 'reset-input' })
    ).toStrictEqual([])
  })
})
