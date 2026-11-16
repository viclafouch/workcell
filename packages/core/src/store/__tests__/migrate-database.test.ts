import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrateDatabase } from '#/store/migrate-database.ts'
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
