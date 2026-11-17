import { afterAll, assert, beforeAll, describe, expect, it } from 'vitest'
import {
  createDatabase,
  createMigratedDatabase
} from '#/testing/test-database.ts'
import { SchemaBehindError } from '#/workcell.ts'
import { MIGRATE_COMMAND } from './worker-fixtures.ts'
import {
  closeWorkerTestbed,
  openWorkers,
  openWorkerTestbed
} from './worker-testbed.ts'

describe('the start of a Workcell', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(closeWorkerTestbed)

  it('refuses a schema with a pending migration, and names the command that applies it', async () => {
    const url = await createDatabase()

    const refusal = await openWorkers(url, []).catch((error: unknown) => {
      return error
    })

    assert.instanceOf(refusal, SchemaBehindError)
    expect(refusal.message).toContain(MIGRATE_COMMAND)
    expect(refusal.pendingMigrations).toContain(
      '1794503522675_sandbox-instances'
    )
  })

  it('starts on a schema with no pending migration', async () => {
    const url = await createMigratedDatabase()

    await using agent = await openWorkers(url, [])

    expect(await agent.workers.listWorkers()).toStrictEqual([])
  })
})
