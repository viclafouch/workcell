import { afterAll, assert, beforeAll, describe, expect, it } from 'vitest'
import type { createSecrets } from '@tanstack/ai-sandbox'
import {
  createDatabase,
  createMigratedDatabase
} from '#/testing/test-database.ts'
import { DuplicateSandboxPackageError, SchemaBehindError } from '#/workcell.ts'
import { MIGRATE_COMMAND } from './worker-fixtures.ts'
import {
  closeWorkerTestbed,
  openWorkers,
  openWorkerTestbed
} from './worker-testbed.ts'

type SecretsModule = { createSecrets: typeof createSecrets }

function matchIsSecretsModule(module: unknown): module is SecretsModule {
  return (
    typeof module === 'object' &&
    module !== null &&
    'createSecrets' in module &&
    typeof module.createSecrets === 'function'
  )
}

async function secretsOfASecondSandboxCopy(values: Record<string, string>) {
  const secretsModule = new URL(
    'secrets.js',
    import.meta.resolve('@tanstack/ai-sandbox')
  )
  const secondCopy: unknown = await import(`${secretsModule.href}?second-copy`)

  if (!matchIsSecretsModule(secondCopy)) {
    throw new Error(`${secretsModule.href} no longer exports createSecrets.`)
  }

  return secondCopy.createSecrets(values)
}

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

  it('refuses a repository sandbox whose secrets come from a second copy of the sandbox package, and names the fix', async () => {
    const url = await createMigratedDatabase()

    const refusal = await openWorkers(url, [], {
      sandboxSecrets: await secretsOfASecondSandboxCopy({ GH_TOKEN: 'token' })
    }).catch((error: unknown) => {
      return error
    })

    assert.instanceOf(refusal, DuplicateSandboxPackageError)
    expect(refusal.message).toContain('two copies of @tanstack/ai-sandbox')
    expect(refusal.message).toContain('pnpm install --force')
    expect(refusal.sandboxIds).toStrictEqual(['worker-test'])
  })

  it('refuses a library sandbox whose secrets come from a second copy of the sandbox package', async () => {
    const url = await createMigratedDatabase()

    const refusal = await openWorkers(url, [], {
      librarySecrets: await secretsOfASecondSandboxCopy({ GH_TOKEN: 'token' })
    }).catch((error: unknown) => {
      return error
    })

    assert.instanceOf(refusal, DuplicateSandboxPackageError)
    expect(refusal.sandboxIds).toStrictEqual(['worker-test-library'])
  })
})
