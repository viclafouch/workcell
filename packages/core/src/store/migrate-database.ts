import { join } from 'node:path'
import { runner } from 'node-pg-migrate'

type LogMessage = (message: string) => void

type MigrateDatabaseParams = {
  url: string
  directory: string
  logger: { info: LogMessage; warn: LogMessage; error: LogMessage }
}

export const MIGRATIONS_DIRECTORY = join(import.meta.dirname, 'migrations')

export async function migrateDatabase({
  url,
  directory,
  logger
}: MigrateDatabaseParams) {
  const applied = await runner({
    databaseUrl: { connectionString: url, enableChannelBinding: true },
    dir: directory,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    checkOrder: true,
    singleTransaction: true,
    logger
  })

  return applied.map(({ name }) => {
    return name
  })
}
