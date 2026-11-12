import type { Exception } from '@opentelemetry/api'
import type { ErrorHandler } from '@opentelemetry/core'
import { throttle } from '@tanstack/pacer'

export const EXPORT_FAILURE_LOG_INTERVAL_MS = 60_000

type WarnLogger = {
  warn: (bindings: { error: Exception }, message: string) => void
}

export function logExportFailures(logger: WarnLogger): ErrorHandler {
  return throttle(
    (error: Exception) => {
      logger.warn(
        { error },
        'The telemetry export failed. The next failures stay silent for a minute.'
      )
    },
    { wait: EXPORT_FAILURE_LOG_INTERVAL_MS, trailing: false }
  )
}
