import { afterAll, beforeAll, describe } from 'vitest'
import { runSandboxInstanceStoreConformance } from '@tanstack/ai-sandbox/testkit'
import type { Database } from '#/store/database.ts'
import { createSandboxInstanceStore } from '#/store/sandbox-instance-store.ts'
import {
  createMigratedDatabase,
  openTestDatabase
} from '#/testing/test-database.ts'

let database: Database

describe('createSandboxInstanceStore', () => {
  beforeAll(async () => {
    database = openTestDatabase(await createMigratedDatabase())
  })

  afterAll(async () => {
    await database.close()
  })

  runSandboxInstanceStoreConformance('Postgres', async () => {
    await database.query(
      'empty the sandbox instances',
      'TRUNCATE sandbox_instances'
    )

    return createSandboxInstanceStore(database)
  })
})
