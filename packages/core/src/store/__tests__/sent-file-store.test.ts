import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '#/store/database.ts'
import { createSentFileStore } from '#/store/sent-file-store.ts'
import {
  createMigratedDatabase,
  openTestDatabase
} from '#/testing/test-database.ts'

let database: Database

describe('createSentFileStore', () => {
  beforeAll(async () => {
    database = openTestDatabase(await createMigratedDatabase())
  })

  afterAll(async () => {
    await database.close()
  })

  it('gives a file back once, then forgets it', async () => {
    const sentFiles = createSentFileStore(database)
    const bytes = new TextEncoder().encode('<h1>Q4</h1>')
    const key = await sentFiles.put({
      threadId: 'thread-1',
      name: 'deck.html',
      bytes
    })

    expect(key).toMatch(/^sent-files\/thread-1\//u)
    expect(await sentFiles.take(key)).toStrictEqual(bytes)
    expect(await sentFiles.take(key)).toBeNull()
  })
})
