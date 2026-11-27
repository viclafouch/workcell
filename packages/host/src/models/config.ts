import { z } from 'zod'

export const modelIdSchema = z.string().min(1)

export const gatewayUrlSchema = z.url().refine(
  (gatewayUrl) => {
    const { username, password } = new URL(gatewayUrl)

    return !username && !password
  },
  {
    error:
      'The gateway URL carries no credentials. The gateway key goes in MODEL_API_KEY.'
  }
)

export type ModelRole =
  | 'orchestrator'
  | 'worker'
  | 'compaction'
  | 'title'
  | 'memory'
  | 'grader'

export type ModelConfig = {
  modelIds: Record<ModelRole, string>
  gatewayUrl: string
}

type ModelConfigParams = {
  defaultModelId: string
  roleModelIds: Partial<Record<ModelRole, string>>
  gatewayUrl: string
}

export function toModelConfig({
  defaultModelId,
  roleModelIds,
  gatewayUrl
}: ModelConfigParams): ModelConfig {
  return {
    modelIds: {
      orchestrator: roleModelIds.orchestrator ?? defaultModelId,
      worker: roleModelIds.worker ?? defaultModelId,
      compaction: roleModelIds.compaction ?? defaultModelId,
      title: roleModelIds.title ?? roleModelIds.compaction ?? defaultModelId,
      memory: roleModelIds.memory ?? defaultModelId,
      grader: roleModelIds.grader ?? defaultModelId
    },
    gatewayUrl
  }
}
