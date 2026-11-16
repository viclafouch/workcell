import { describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  EXPORT_FAILURE_LOG_INTERVAL_MS,
  logExportFailures
} from '#/telemetry/export-failures.ts'

function recordWarnings() {
  const warnings: [{ error: unknown }, string][] = []

  return {
    warnings,
    logger: {
      warn: (bindings: { error: unknown }, message: string) => {
        warnings.push([bindings, message])
      }
    }
  }
}

describe('logExportFailures', () => {
  it('logs the first export failure of each interval, and drops the others', () => {
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const { warnings, logger } = recordWarnings()
    const reportFailure = logExportFailures(logger)
    const refused = new Error('connect ECONNREFUSED 127.0.0.1:4318')
    const refusedAgain = new Error('connect ECONNREFUSED 127.0.0.1:4318')
    const timedOut = new Error('Timeout')

    reportFailure(refused)
    reportFailure(refusedAgain)
    vi.advanceTimersByTime(EXPORT_FAILURE_LOG_INTERVAL_MS)
    reportFailure(timedOut)

    expect(
      warnings.map(([{ error }]) => {
        return error
      })
    ).toStrictEqual([refused, timedOut])
  })
})
