import { inspect } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import {
  openTestDatabase,
  recordLogs,
  createDatabase
} from './test-database.ts'

const TRANSCRIPT_TEXT = 'the customer asked for a refund'

const FIRST_TERM = 2

const SECOND_TERM = 3

const CLOSED_PORT_URL = 'postgres://agent:agent@127.0.0.1:1/agent'

async function createTurnsDatabase(
  logger?: Parameters<typeof openTestDatabase>[1]
) {
  const database = openTestDatabase(await createDatabase(), logger)
  await database.query(
    'create the turns',
    'CREATE TABLE turns (id int PRIMARY KEY)'
  )

  return database
}

describe('openDatabase', () => {
  it('returns the rows of a query', async () => {
    const database = openTestDatabase(await createDatabase())

    const rows = await database.query(
      'add two numbers',
      'SELECT $1::int + $2::int AS sum',
      [FIRST_TERM, SECOND_TERM]
    )
    await database.close()

    expect(rows).toStrictEqual([{ sum: 5 }])
  })

  it('serves two queries at once', async () => {
    const database = openTestDatabase(await createDatabase())

    const answers = await Promise.all([
      database.query('read the first turn', 'SELECT 1 AS turn'),
      database.query('read the second turn', 'SELECT 2 AS turn')
    ])
    await database.close()

    expect(answers).toStrictEqual([[{ turn: 1 }], [{ turn: 2 }]])
  })

  it('logs a failed query with its name and code, and keeps its parameters out of the log and the error', async () => {
    const { logger, lines } = recordLogs()
    const database = openTestDatabase(await createDatabase(), logger)

    const failure = await database
      .query('read a turn', 'SELECT $1::int AS turn', [TRANSCRIPT_TEXT])
      .catch((error: unknown) => {
        return error
      })
    await database.close()

    expect(failure).toMatchObject({ code: '22P02' })
    expect(inspect(failure, { depth: Infinity })).not.toContain(TRANSCRIPT_TEXT)
    expect(lines).toStrictEqual([
      {
        level: 'error',
        details: { queryName: 'read a turn', code: '22P02' },
        message: 'The query failed.'
      }
    ])
  })

  it('survives the server closing an idle connection, and serves the next query', async () => {
    const url = await createDatabase()
    const { logger, lines } = recordLogs()
    const database = openTestDatabase(url, logger)
    const admin = openTestDatabase(url)
    await database.query('wake the pool', 'SELECT 1')

    await admin.query(
      'close the other connections',
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()'
    )
    await vi.waitFor(() => {
      expect(lines).toStrictEqual([
        {
          level: 'warn',
          details: { code: '57P01' },
          message: 'The server closed an idle database connection.'
        }
      ])
    })
    const rows = await database.query('read after the close', 'SELECT 1 AS one')
    await Promise.all([database.close(), admin.close()])

    expect(rows).toStrictEqual([{ one: 1 }])
  })

  it('closes every connection of the pool on close', async () => {
    const url = await createDatabase()
    const database = openTestDatabase(url)
    const admin = openTestDatabase(url)
    await database.query('wake the pool', 'SELECT 1')

    await database.close()
    const rows = await admin.query(
      'count the other connections',
      'SELECT count(*)::int AS connections FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()'
    )
    await admin.close()

    expect(rows).toStrictEqual([{ connections: 0 }])
  })

  it('fails on a wrong password with no retry', async () => {
    const url = await createDatabase()
    const { logger, lines } = recordLogs()
    const wrongPasswordUrl = new URL(url)
    wrongPasswordUrl.password = 'wrong'
    const database = openTestDatabase(wrongPasswordUrl.toString(), logger)

    const failure = await database
      .query('read a turn', 'SELECT 1')
      .catch((error: unknown) => {
        return error
      })
    await database.close()

    expect(failure).toMatchObject({ code: '28P01' })
    expect(lines).toStrictEqual([
      {
        level: 'error',
        details: { queryName: 'read a turn', code: '28P01' },
        message: 'The query failed.'
      }
    ])
  })

  it('retries a refused connection twice, then fails with the code of the refusal', async () => {
    const { logger, lines } = recordLogs()
    const database = openTestDatabase(CLOSED_PORT_URL, logger)

    const failure = await database
      .query('read a turn', 'SELECT 1')
      .catch((error: unknown) => {
        return error
      })
    await database.close()

    expect(failure).toMatchObject({ code: 'ECONNREFUSED' })
    expect(lines).toStrictEqual([
      {
        level: 'warn',
        details: { attempt: 1, code: 'ECONNREFUSED' },
        message: 'The database connection failed. Retrying.'
      },
      {
        level: 'warn',
        details: { attempt: 2, code: 'ECONNREFUSED' },
        message: 'The database connection failed. Retrying.'
      },
      {
        level: 'error',
        details: { queryName: 'read a turn', code: 'ECONNREFUSED' },
        message: 'The query failed.'
      }
    ])
  })

  it('commits every write of a transaction', async () => {
    await using database = await createTurnsDatabase()

    await database.transaction('add two turns', async (query) => {
      await query('INSERT INTO turns VALUES (1)')
      await query('INSERT INTO turns VALUES (2)')
    })
    const turns = await database.query(
      'read the turns',
      'SELECT id FROM turns ORDER BY id'
    )

    expect(turns).toStrictEqual([{ id: 1 }, { id: 2 }])
  })

  it('rolls back a transaction whose work throws, and rethrows that error with no log', async () => {
    const { logger, lines } = recordLogs()
    await using database = await createTurnsDatabase(logger)
    const refusal = new RangeError('The turn is refused.')

    const failure = await database
      .transaction('add a refused turn', async (query) => {
        await query('INSERT INTO turns VALUES (1)')

        throw refusal
      })
      .catch((error: unknown) => {
        return error
      })
    const turns = await database.query('read the turns', 'SELECT id FROM turns')

    expect({ failure, turns, lines }).toStrictEqual({
      failure: refusal,
      turns: [],
      lines: []
    })
  })

  it('rolls back a transaction whose query fails, and logs the name of the transaction', async () => {
    const { logger, lines } = recordLogs()
    await using database = await createTurnsDatabase(logger)

    const failure = await database
      .transaction('add a turn twice', async (query) => {
        await query('INSERT INTO turns VALUES (1)')
        await query('INSERT INTO turns VALUES (1)')
      })
      .catch((error: unknown) => {
        return error
      })
    const turns = await database.query('read the turns', 'SELECT id FROM turns')

    expect(failure).toMatchObject({
      queryName: 'add a turn twice',
      code: '23505'
    })
    expect({ turns, lines }).toStrictEqual({
      turns: [],
      lines: [
        {
          level: 'error',
          details: { queryName: 'add a turn twice', code: '23505' },
          message: 'The query failed.'
        }
      ]
    })
  })
})
