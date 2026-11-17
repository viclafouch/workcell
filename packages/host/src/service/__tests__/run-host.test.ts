import { describe, expect, it } from 'vitest'
import { DuplicateSandboxPackageError, SchemaBehindError } from '@workcell/core'
import { runHost } from '#/service/run-host.ts'

function recordErrors() {
  const lines: { details: Record<string, unknown>; message: string }[] = []

  return {
    lines,
    log: {
      error: (details: Record<string, unknown>, message: string) => {
        lines.push({ details, message })
      }
    }
  }
}

describe('runHost', () => {
  it('ends cleanly a host that refuses a schema behind its code, and logs the refusal', async () => {
    const { lines, log } = recordErrors()

    await runHost(async () => {
      throw new SchemaBehindError(['2_create_turns'], 'acme db:migrate')
    }, log)

    expect(lines).toStrictEqual([
      {
        details: { pendingMigrations: ['2_create_turns'] },
        message:
          'The database schema is behind the code: 2_create_turns never ran. Run acme db:migrate, then start again.'
      }
    ])
  })

  it('ends cleanly a host that loads two copies of the sandbox package, and logs the refusal', async () => {
    const { lines, log } = recordErrors()

    await runHost(async () => {
      throw new DuplicateSandboxPackageError(['repo-sandbox'])
    }, log)

    expect(lines).toStrictEqual([
      {
        details: { sandboxIds: ['repo-sandbox'] },
        message:
          'The core cannot read the workspace secrets of repo-sandbox: two copies of @tanstack/ai-sandbox are loaded. Install from the parent workspace only, then force a reinstall, such as `pnpm install --force`.'
      }
    ])
  })

  it('lets any other failure of the host through', async () => {
    const { lines, log } = recordErrors()
    const crash = new Error('The sandbox provider did not answer at start.')

    const failure = runHost(async () => {
      throw crash
    }, log)

    await expect(failure).rejects.toBe(crash)
    expect(lines).toStrictEqual([])
  })
})
