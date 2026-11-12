import {
  createHarnessHost,
  type HarnessHostOptions,
  type HarnessPersistence
} from '@tanstack/ai-harness'

type CreateAgentHostParams = HarnessHostOptions & {
  persistence: HarnessPersistence
}

export function createAgentHost({
  lifecycle,
  ...options
}: CreateAgentHostParams) {
  return createHarnessHost({
    ...options,
    lifecycle: {
      ...lifecycle,
      retention: { ...lifecycle?.retention, keepLogRecords: 'since-snapshot' }
    }
  })
}
