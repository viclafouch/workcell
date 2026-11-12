import {
  getBooleanFromEnv,
  getStringFromEnv,
  getStringListFromEnv,
  setGlobalErrorHandler
} from '@opentelemetry/core'
import type { NodeSDK } from '@opentelemetry/sdk-node'
import { logExportFailures } from './export-failures.ts'

const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318'

type TelemetryLogger = {
  info: (bindings: object, message: string) => void
  warn: (bindings: object, message: string) => void
}

type OpenTelemetryParams = {
  sdk: Pick<NodeSDK, 'shutdown'>
  logger: TelemetryLogger
}

function exportTarget() {
  return {
    traces: getStringListFromEnv('OTEL_TRACES_EXPORTER') ?? ['otlp'],
    metrics: getStringListFromEnv('OTEL_METRICS_EXPORTER') ?? ['none'],
    endpoint:
      getStringFromEnv('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT') ??
      getStringFromEnv('OTEL_EXPORTER_OTLP_ENDPOINT') ??
      DEFAULT_OTLP_ENDPOINT
  }
}

export function openTelemetry({ sdk, logger }: OpenTelemetryParams) {
  setGlobalErrorHandler(logExportFailures(logger))

  if (getBooleanFromEnv('OTEL_SDK_DISABLED')) {
    logger.info({}, 'The telemetry is off.')
  } else {
    logger.info(exportTarget(), 'The telemetry exports to its target.')
  }

  return {
    [Symbol.asyncDispose]: async () => {
      try {
        await sdk.shutdown()
      } catch (error) {
        logger.warn({ error }, 'The telemetry did not flush at shutdown.')
      }
    }
  }
}
