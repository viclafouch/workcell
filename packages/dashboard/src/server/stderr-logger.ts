import type { DashboardLogger } from './dashboard-context.ts'

export const STDERR_LOGGER: DashboardLogger = {
  error: (bindings, message) => {
    process.stderr.write(`${message} ${JSON.stringify(bindings)}\n`)
  }
}
