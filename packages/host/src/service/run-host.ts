import { SchemaBehindError } from '@workcell/core'

type LogLine = (details: Record<string, unknown>, message: string) => void

export async function runHost(
  serve: () => Promise<void>,
  log: { error: LogLine }
) {
  try {
    await serve()
  } catch (error) {
    if (!(error instanceof SchemaBehindError)) {
      throw error
    }

    log.error({ pendingMigrations: error.pendingMigrations }, error.message)
  }
}
