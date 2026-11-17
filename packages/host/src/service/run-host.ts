import { DuplicateSandboxPackageError, SchemaBehindError } from '@workcell/core'

type LogLine = (details: Record<string, unknown>, message: string) => void

function startRefusalOf(error: unknown) {
  if (error instanceof SchemaBehindError) {
    return {
      details: { pendingMigrations: error.pendingMigrations },
      message: error.message
    }
  }

  if (error instanceof DuplicateSandboxPackageError) {
    return { details: { sandboxIds: error.sandboxIds }, message: error.message }
  }

  return null
}

export async function runHost(
  serve: () => Promise<void>,
  log: { error: LogLine }
) {
  try {
    await serve()
  } catch (error) {
    const refusal = startRefusalOf(error)

    if (refusal === null) {
      throw error
    }

    log.error(refusal.details, refusal.message)
  }
}
