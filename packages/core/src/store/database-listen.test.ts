import { describe, expect, it } from 'vitest'
import type { Database, DatabaseNotice } from './database.ts'
import {
  openTestDatabase,
  recordLogs,
  createDatabase
} from './test-database.ts'

const COUNT_LISTENERS =
  "SELECT count(*)::int AS listeners FROM pg_stat_activity WHERE query LIKE 'LISTEN%' AND datname = current_database()"

async function listenUntilActive(database: Database, channel: string) {
  const notices: DatabaseNotice[] = []
  const stop = database.listen(channel, (notice) => {
    notices.push(notice)
  })

  await expect
    .poll(() => {
      return notices
    })
    .toStrictEqual([{ kind: 'listening' }])
  notices.length = 0

  return { notices, stop }
}

describe('openDatabase listeners', () => {
  it('tells a listener when its LISTEN is active, then delivers each notification', async () => {
    await using database = openTestDatabase(await createDatabase())
    const { notices, stop } = await listenUntilActive(database, 'turns')

    await database.query('notify a turn', "SELECT pg_notify('turns', 'turn-1')")

    await expect
      .poll(() => {
        return notices
      })
      .toStrictEqual([{ kind: 'notification', payload: 'turn-1' }])
    stop()
  })

  it('reconnects a listener whose connection drops, and tells it to read again', async () => {
    const { logger, lines } = recordLogs()
    await using database = openTestDatabase(await createDatabase(), logger)
    const { notices, stop } = await listenUntilActive(database, 'turns')

    await database.query(
      'close the listener connection',
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query LIKE 'LISTEN%' AND datname = current_database()"
    )
    await expect
      .poll(() => {
        return notices
      })
      .toStrictEqual([{ kind: 'reconnected' }])
    await database.query('notify a turn', "SELECT pg_notify('turns', 'turn-2')")
    await expect
      .poll(() => {
        return notices
      })
      .toStrictEqual([
        { kind: 'reconnected' },
        { kind: 'notification', payload: 'turn-2' }
      ])
    stop()

    expect(lines).toContainEqual({
      level: 'warn',
      details: { code: '57P01' },
      message: 'The database listener lost its connection.'
    })
  })

  it('closes the listener connection when the last listener stops', async () => {
    await using database = openTestDatabase(await createDatabase())
    const first = await listenUntilActive(database, 'turns')
    const second = await listenUntilActive(database, 'runs')

    first.stop()
    const whileOneListens = await database.query(
      'count the listeners',
      COUNT_LISTENERS
    )
    second.stop()

    expect(whileOneListens).toStrictEqual([{ listeners: 1 }])
    await expect
      .poll(async () => {
        return database.query('count the listeners', COUNT_LISTENERS)
      })
      .toStrictEqual([{ listeners: 0 }])
  })
})
