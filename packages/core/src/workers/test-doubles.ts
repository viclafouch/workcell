import { toolDefinition } from '@tanstack/ai'
import { definePlugin, PermissionRules } from '@tanstack/ai-harness'
import type { ModelPricing } from '#core/budget/budget'
import type { BudgetLimits } from '#core/budget/limits'

export const FREE_MODEL_PRICING: ModelPricing = {
  requirePrices: () => {},
  costOfCall: () => {
    return 0
  },
  costOfUsage: () => {
    return 0
  },
  modelCost: () => {
    return { cost: { input: 0, output: 0 } }
  }
}

export const ROOMY_LIMITS: BudgetLimits = {
  maxCostUsd: 100
}

export const SILENT_HOST_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
}

export const TEST_STARTER = { id: 'test-starter' }

export const TEST_MAX_RUNNING_TURNS = 2

export const LONG_HOST_TOOL = 'read_long_host_result'

const LONG_HOST_RESULT_LINES = 3_000

const LONG_HOST_RESULT = 'A line of a long host tool result.\n'.repeat(
  LONG_HOST_RESULT_LINES
)

export const OVERLOADED_MODEL_ERROR =
  '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'

export const longHostTool = definePlugin({
  name: 'test/long-host-tool',
  setup: () => {
    return {
      tools: [
        toolDefinition({
          name: LONG_HOST_TOOL,
          description: 'Read a long result on the host.'
        }).server(async () => {
          return LONG_HOST_RESULT
        })
      ],
      contribute: [
        PermissionRules.item({
          tool: LONG_HOST_TOOL,
          decision: 'allow',
          kind: 'read'
        })
      ]
    }
  }
})
