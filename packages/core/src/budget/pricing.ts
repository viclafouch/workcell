import type { TokenUsage } from '@tanstack/ai'
import type { SessionUsage, UsageCounts } from '@tanstack/ai-harness'

type ModelPrices = {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

export type ModelPriceTable = Readonly<Record<string, ModelPrices>>

type BilledTokens = Pick<
  UsageCounts,
  'promptTokens' | 'completionTokens' | 'cachedTokens' | 'cacheWriteTokens'
>

const TOKENS_PER_PRICE_UNIT = 1_000_000

function findPrices(table: ModelPriceTable, modelId: string) {
  return Object.hasOwn(table, modelId) ? table[modelId] : undefined
}

function pricesOf(table: ModelPriceTable, modelId: string) {
  const prices = findPrices(table, modelId)

  if (prices === undefined) {
    throw new Error(
      `The model ${modelId} has no price: add it to the price table of createModelPricing().`
    )
  }

  return prices
}

function priceTokens(
  prices: ModelPrices,
  {
    promptTokens,
    completionTokens,
    cachedTokens,
    cacheWriteTokens
  }: BilledTokens
) {
  const uncachedTokens = promptTokens - cachedTokens - cacheWriteTokens
  const dollars =
    prices.input * uncachedTokens +
    prices.output * completionTokens +
    (prices.cacheRead ?? 0) * cachedTokens +
    (prices.cacheWrite ?? 0) * cacheWriteTokens

  return dollars / TOKENS_PER_PRICE_UNIT
}

function modelIdOf(providerAndModel: string) {
  return providerAndModel.slice(providerAndModel.indexOf('/') + 1)
}

export function createModelPricing(table: ModelPriceTable) {
  return {
    requirePrices: (modelIds: readonly string[]) => {
      for (const modelId of modelIds) {
        pricesOf(table, modelId)
      }
    },
    costOfCall: (modelId: string, usage: TokenUsage) => {
      return (
        usage.cost ??
        priceTokens(pricesOf(table, modelId), {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          cachedTokens: usage.promptTokensDetails?.cachedTokens ?? 0,
          cacheWriteTokens: usage.promptTokensDetails?.cacheWriteTokens ?? 0
        })
      )
    },
    costOfUsage: (usage: SessionUsage) => {
      return Object.entries(usage.byModel).reduce((total, [model, counts]) => {
        return (
          total +
          (counts.cost ??
            priceTokens(pricesOf(table, modelIdOf(model)), counts))
        )
      }, 0)
    },
    modelCost: (modelId: string) => {
      const prices = findPrices(table, modelId)

      return prices === undefined ? undefined : { cost: prices }
    }
  }
}
