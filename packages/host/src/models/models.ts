import type { AnyTextAdapter } from '@tanstack/ai'
import { ANTHROPIC_MODELS, createAnthropicChat } from '@tanstack/ai-anthropic'
import { createOpenaiChat, OPENAI_CHAT_MODELS } from '@tanstack/ai-openai'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import type { ModelConfig, ModelRole } from './config.ts'

const GATEWAY_PROVIDER = 'model-gateway'

type CreateModelsParams = {
  modelKey: string
  config: ModelConfig
  roleHeaders?: (role: ModelRole) => Record<string, string>
}

type ModelSource = {
  provider: string
  api: string | undefined
  model: string
}

type ModelsSummary = {
  gateway: string
  models: Record<ModelRole, ModelSource>
}

type Models = {
  summary: ModelsSummary
  textAdapter: (role: ModelRole) => AnyTextAdapter
}

type GatewayAdapterParams = {
  modelId: string
  modelKey: string
  gatewayUrl: string
  defaultHeaders: Record<string, string>
}

function matchIsCatalogModel<CatalogModel extends string>(
  catalog: readonly CatalogModel[],
  modelId: string
): modelId is CatalogModel {
  return catalog.some((catalogModel) => {
    return catalogModel === modelId
  })
}

function createGatewayAdapter({
  modelId,
  modelKey,
  gatewayUrl,
  defaultHeaders
}: GatewayAdapterParams) {
  const openaiBaseUrl = `${gatewayUrl.replace(/\/$/u, '')}/v1`

  if (matchIsCatalogModel(ANTHROPIC_MODELS, modelId)) {
    return createAnthropicChat(modelId, modelKey, {
      baseURL: gatewayUrl,
      provider: GATEWAY_PROVIDER,
      defaultHeaders
    })
  }

  if (matchIsCatalogModel(OPENAI_CHAT_MODELS, modelId)) {
    return createOpenaiChat(modelId, modelKey, {
      baseURL: openaiBaseUrl,
      defaultHeaders
    })
  }

  return openaiCompatibleText(modelId, {
    name: GATEWAY_PROVIDER,
    baseURL: openaiBaseUrl,
    apiKey: modelKey,
    defaultHeaders
  })
}

function mapRoles<Value>(
  toValue: (role: ModelRole) => Value
): Record<ModelRole, Value> {
  return {
    orchestrator: toValue('orchestrator'),
    worker: toValue('worker'),
    compaction: toValue('compaction'),
    memory: toValue('memory'),
    grader: toValue('grader')
  }
}

function noHeaders() {
  return {}
}

export function createModels({
  modelKey,
  config,
  roleHeaders = noHeaders
}: CreateModelsParams): Models {
  const { modelIds, gatewayUrl } = config
  const adapters = mapRoles((role): AnyTextAdapter => {
    return createGatewayAdapter({
      modelId: modelIds[role],
      modelKey,
      gatewayUrl,
      defaultHeaders: roleHeaders(role)
    })
  })

  return {
    summary: {
      gateway: new URL(gatewayUrl).origin,
      models: mapRoles((role) => {
        const adapter = adapters[role]

        return {
          provider: adapter.provider ?? adapter.name,
          api: adapter.api,
          model: modelIds[role]
        }
      })
    },
    textAdapter: (role) => {
      return adapters[role]
    }
  }
}
