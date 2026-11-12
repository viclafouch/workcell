import { AsyncRetryer } from '@tanstack/pacer'
import type { LogLine } from './mcp-server-log.ts'

const START_ATTEMPTS = 12
const START_MAX_WAIT_MS = 30_000

export async function waitUntilReady<Answer>(
  dependency: string,
  probe: () => Promise<Answer>,
  log: { warn: LogLine }
) {
  try {
    await new AsyncRetryer(probe, {
      maxAttempts: START_ATTEMPTS,
      maxWait: START_MAX_WAIT_MS,
      jitter: 0.25,
      onRetry: (attempt, error) => {
        log.warn(
          { dependency, attempt, error },
          'dependency not ready at start'
        )
      }
    }).execute()
  } catch (error) {
    throw new Error(`The ${dependency} did not answer at start.`, {
      cause: error
    })
  }
}
