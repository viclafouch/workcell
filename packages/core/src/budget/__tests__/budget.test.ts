import { describe, expect, it } from 'vitest'
import { capUsdOf } from '#/budget/budget.ts'

const BUDGET_PLUGIN = 'workcell/worker-budget'

const LIMITS = { maxCostUsd: 5 }

const APPROVED_USD = 4

describe('the budget cap of a task', () => {
  it('comes from the limits before the task saved any spend', () => {
    expect(capUsdOf({}, LIMITS)).toBe(LIMITS.maxCostUsd)
  })

  it('starts again from the spend a person approved last', () => {
    const plugins = {
      [BUDGET_PLUGIN]: {
        spentAtLastAnswerUsd: APPROVED_USD,
        summaryUsd: 0,
        summaryCalls: 0
      }
    }

    expect(capUsdOf(plugins, LIMITS)).toBe(APPROVED_USD + LIMITS.maxCostUsd)
  })

  it('keeps the cap the task saved', () => {
    const plugins = {
      [BUDGET_PLUGIN]: {
        spentAtLastAnswerUsd: 0,
        summaryUsd: 0,
        summaryCalls: 0,
        capUsd: 2
      }
    }

    expect(capUsdOf(plugins, LIMITS)).toBe(2)
  })
})
