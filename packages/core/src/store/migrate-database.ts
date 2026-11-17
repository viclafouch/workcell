import { join } from 'node:path'
import { runner } from 'node-pg-migrate'

type LogMessage = (message: string) => void

type MigrationLogger = { info: LogMessage; warn: LogMessage; error: LogMessage }

type FindPendingMigrationsParams = {
  url: string
  directory: string
}

type MigrateDatabaseParams = FindPendingMigrationsParams & {
  logger: MigrationLogger
}

export const MIGRATIONS_DIRECTORY = join(import.meta.dirname, 'migrations')

const SILENT_MIGRATION_LOGGER: MigrationLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
}

function runnerOptions({ url, directory }: FindPendingMigrationsParams) {
  return {
    databaseUrl: { connectionString: url, enableChannelBinding: true },
    dir: directory,
    direction: 'up',
    migrationsTable: 'pgmigrations'
  } as const
}

function namesOf(migrations: Awaited<ReturnType<typeof runner>>) {
  return migrations.map(({ name }) => {
    return name
  })
}

export async function migrateDatabase({
  logger,
  ...location
}: MigrateDatabaseParams) {
  return namesOf(
    await runner({
      ...runnerOptions(location),
      checkOrder: true,
      singleTransaction: true,
      logger
    })
  )
}

export async function findPendingMigrations(
  location: FindPendingMigrationsParams
) {
  return namesOf(
    await runner({
      ...runnerOptions(location),
      checkOrder: false,
      dryRun: true,
      noLock: true,
      singleTransaction: false,
      logger: SILENT_MIGRATION_LOGGER
    })
  )
}
