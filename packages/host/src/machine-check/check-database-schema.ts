import { findPendingMigrations, MIGRATIONS_DIRECTORY } from '@workcell/core'
import type { CheckResult } from './check-result.ts'
import type { MachineCommands } from './machine-commands.ts'

const LABEL = 'Schema'

const DIRECT_URL_SECRET = 'DATABASE_URL_UNPOOLED'

type CheckDatabaseSchemaParams = {
  store: {
    read: (name: typeof DIRECT_URL_SECRET) => Promise<string | undefined>
  }
  commands: Pick<MachineCommands, 'check' | 'migrate' | 'setSecret'>
}

async function pendingMigrationsAt(url: string) {
  try {
    return {
      pendingMigrations: await findPendingMigrations({
        url,
        directory: MIGRATIONS_DIRECTORY
      })
    }
  } catch (error) {
    return { failure: Error.isError(error) ? error.message : String(error) }
  }
}

export async function checkDatabaseSchema({
  store,
  commands
}: CheckDatabaseSchemaParams): Promise<CheckResult> {
  const url = await store.read(DIRECT_URL_SECRET)

  if (!url) {
    return {
      label: LABEL,
      ok: false,
      fix: `Missing ${DIRECT_URL_SECRET}: ${commands.setSecret(DIRECT_URL_SECRET)}`
    }
  }

  const { pendingMigrations, failure } = await pendingMigrationsAt(url)

  if (pendingMigrations === undefined) {
    return {
      label: LABEL,
      ok: false,
      fix: `The schema check failed with ${failure}: fix the database, then run ${commands.check} again`
    }
  }

  if (pendingMigrations.length > 0) {
    return {
      label: LABEL,
      ok: false,
      fix: `${pendingMigrations.join(', ')} never ran: ${commands.migrate}`
    }
  }

  return { label: LABEL, ok: true }
}
