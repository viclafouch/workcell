import { createExtensionPoint } from '@tanstack/ai-harness'

export type BudgetLimits = {
  maxCostUsd: number
}

type EntrySkillLimit = {
  entrySkill: string
  limits: BudgetLimits
}

export const EntrySkillLimits = createExtensionPoint<EntrySkillLimit>(
  'workcell/entry-skill-limits'
)
