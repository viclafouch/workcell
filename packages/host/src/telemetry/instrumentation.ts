import { getStringListFromEnv } from '@opentelemetry/core'
import { NodeSDK } from '@opentelemetry/sdk-node'

type TelemetryParams = {
  serviceName: string
}

export function startTelemetry({ serviceName }: TelemetryParams) {
  const metricsExporters = getStringListFromEnv('OTEL_METRICS_EXPORTER')
  const telemetrySdk = new NodeSDK({
    serviceName,
    ...(metricsExporters === undefined && { metricReaders: [] })
  })
  telemetrySdk.start()

  return telemetrySdk
}
