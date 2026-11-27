import type { ConsoleLogger } from './console-context.ts'

export const STDERR_LOGGER: ConsoleLogger = {
  error: (bindings, message) => {
    process.stderr.write(`${message} ${JSON.stringify(bindings)}\n`)
  }
}
