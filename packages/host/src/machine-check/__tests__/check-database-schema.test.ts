import { assert, describe, expect, it } from 'vitest'
import { createDatabase, createMigratedDatabase } from '@workcell/core/testing'
import { checkDatabaseSchema } from '#/machine-check/check-database-schema.ts'

const COMMANDS = {
  check: 'acme machine:check',
  migrate: 'acme db:migrate',
  setSecret: (name: string) => {
    return `acme secrets:set ${name}`
  }
}

const CLOSED_DATABASE_URL = 'postgres://acme:acme@127.0.0.1:1/acme'

function storeHolding(url: string | undefined) {
  return {
    read: async () => {
      return url
    }
  }
}

describe('checkDatabaseSchema', () => {
  it('names the pending migrations and the command that applies them', async () => {
    const url = await createDatabase()

    const result = await checkDatabaseSchema({
      store: storeHolding(url),
      commands: COMMANDS
    })

    assert(!result.ok)
    expect(result.label).toBe('Schema')
    expect(result.fix).toMatch(
      /1794503522675_sandbox-instances.* never ran: acme db:migrate$/u
    )
  })

  it('passes a schema with no pending migration', async () => {
    const url = await createMigratedDatabase()

    const result = await checkDatabaseSchema({
      store: storeHolding(url),
      commands: COMMANDS
    })

    expect(result).toStrictEqual({ label: 'Schema', ok: true })
  })

  it('names the fix of a missing database secret and of a database that does not answer', async () => {
    const results = await Promise.all(
      [undefined, CLOSED_DATABASE_URL].map((url) => {
        return checkDatabaseSchema({
          store: storeHolding(url),
          commands: COMMANDS
        })
      })
    )

    expect(results).toStrictEqual([
      {
        label: 'Schema',
        ok: false,
        fix: 'Missing DATABASE_URL_UNPOOLED: acme secrets:set DATABASE_URL_UNPOOLED'
      },
      {
        label: 'Schema',
        ok: false,
        fix: 'The schema check failed with connect ECONNREFUSED 127.0.0.1:1: fix the database, then run acme machine:check again'
      }
    ])
  })
})
