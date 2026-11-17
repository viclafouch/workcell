import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findPendingMigrations,
  migrateDatabase
} from '#/store/migrate-database.ts'
import {
  openTestDatabase,
  SILENT_LOGGER,
  createDatabase
} from '#/testing/test-database.ts'

const CREATE_TURNS_MIGRATION = `-- Up Migration
CREATE TABLE turns (id int PRIMARY KEY);

-- Down Migration
DROP TABLE turns;
`

async function createMigrationDirectory(files: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), 'workcell-migrations-'))
  await Promise.all(
    Object.entries(files).map(([name, content]) => {
      return writeFile(join(directory, name), content)
    })
  )

  return directory
}

describe('migrateDatabase', () => {
  it('applies each pending migration once', async () => {
    const url = await createDatabase()
    const directory = await createMigrationDirectory({
      '1_create_turns.sql': CREATE_TURNS_MIGRATION
    })

    const firstRun = await migrateDatabase({
      url,
      directory,
      logger: SILENT_LOGGER
    })
    const secondRun = await migrateDatabase({
      url,
      directory,
      logger: SILENT_LOGGER
    })
    const database = openTestDatabase(url)
    const turns = await database.query('read the turns', 'SELECT id FROM turns')
    await database.close()
    await rm(directory, { recursive: true })

    expect({ firstRun, secondRun, turns }).toStrictEqual({
      firstRun: ['1_create_turns'],
      secondRun: [],
      turns: []
    })
  })

  it('rolls back every migration of a run when one fails', async () => {
    const url = await createDatabase()
    const directory = await createMigrationDirectory({
      '1_create_turns.sql': CREATE_TURNS_MIGRATION,
      '2_broken.sql': '-- Up Migration\nSELECT * FROM missing_table;\n'
    })

    const failure = await migrateDatabase({
      url,
      directory,
      logger: SILENT_LOGGER
    }).catch((error: unknown) => {
      return error
    })
    const database = openTestDatabase(url)
    const tables = await database.query(
      'find the turns table',
      "SELECT to_regclass('turns')::text AS turns"
    )
    await database.close()
    await rm(directory, { recursive: true })

    expect(failure).toBeInstanceOf(Error)
    expect(tables).toStrictEqual([{ turns: null }])
  })

  it('applies nothing from a directory with no migration', async () => {
    const url = await createDatabase()
    const directory = await createMigrationDirectory({ '.gitkeep': '' })

    const applied = await migrateDatabase({
      url,
      directory,
      logger: SILENT_LOGGER
    })
    await rm(directory, { recursive: true })

    expect(applied).toStrictEqual([])
  })
})

describe('findPendingMigrations', () => {
  it('names each migration the schema still lacks, and applies none', async () => {
    const url = await createDatabase()
    const directory = await createMigrationDirectory({
      '1_create_turns.sql': CREATE_TURNS_MIGRATION
    })

    const pending = await findPendingMigrations({ url, directory })
    const database = openTestDatabase(url)
    const tables = await database.query(
      'find the turns table',
      "SELECT to_regclass('turns')::text AS turns"
    )
    await database.close()
    await rm(directory, { recursive: true })

    expect({ pending, tables }).toStrictEqual({
      pending: ['1_create_turns'],
      tables: [{ turns: null }]
    })
  })

  it('names nothing once every migration ran', async () => {
    const url = await createDatabase()
    const directory = await createMigrationDirectory({
      '1_create_turns.sql': CREATE_TURNS_MIGRATION
    })
    await migrateDatabase({ url, directory, logger: SILENT_LOGGER })

    const pending = await findPendingMigrations({ url, directory })
    await rm(directory, { recursive: true })

    expect(pending).toStrictEqual([])
  })

  it('names a migration that sorts before one that already ran', async () => {
    const url = await createDatabase()
    const directory = await createMigrationDirectory({
      '2_create_turns.sql': CREATE_TURNS_MIGRATION
    })
    await migrateDatabase({ url, directory, logger: SILENT_LOGGER })
    await writeFile(
      join(directory, '1_create_runs.sql'),
      '-- Up Migration\nCREATE TABLE runs (id int PRIMARY KEY);\n'
    )

    const pending = await findPendingMigrations({ url, directory })
    await rm(directory, { recursive: true })

    expect(pending).toStrictEqual(['1_create_runs'])
  })
})
