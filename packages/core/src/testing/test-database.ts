import { randomUUIDv7 } from 'node:crypto'
import { inject } from 'vitest'
import { openDatabase, type LogLine } from '#/store/database.ts'
import {
  MIGRATIONS_DIRECTORY,
  migrateDatabase
} from '#/store/migrate-database.ts'

declare module 'vitest' {
  export interface ProvidedContext {
    postgresUrl: string
  }
}

export const SILENT_LOGGER = {
  info: () => {},
  warn: () => {},
  error: () => {}
}

type RecordedLine = {
  level: 'warn' | 'error'
  details: Record<string, unknown>
  message: string
}

export function recordLogs() {
  const lines: RecordedLine[] = []
  const recordAt = (level: RecordedLine['level']): LogLine => {
    return (details, message) => {
      lines.push({ level, details, message })
    }
  }

  return { lines, logger: { warn: recordAt('warn'), error: recordAt('error') } }
}

export function openTestDatabase(
  url: string,
  logger: Parameters<typeof openDatabase>[0]['logger'] = SILENT_LOGGER
) {
  return openDatabase({ url, directUrl: url, logger })
}

export async function createDatabase() {
  const postgresUrl = inject('postgresUrl')
  const name = `test_${randomUUIDv7().replaceAll('-', '')}`
  await using admin = openTestDatabase(postgresUrl)
  await admin.query('create a test database', `CREATE DATABASE ${name}`)
  const databaseUrl = new URL(postgresUrl)
  databaseUrl.pathname = `/${name}`

  return databaseUrl.toString()
}

export async function createMigratedDatabase() {
  const databaseUrl = await createDatabase()
  await migrateDatabase({
    url: databaseUrl,
    directory: MIGRATIONS_DIRECTORY,
    logger: SILENT_LOGGER
  })

  return databaseUrl
}
