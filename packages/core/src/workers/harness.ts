import type { AnyTextAdapter, ChatMiddleware } from '@tanstack/ai'
import {
  defineHarness,
  retryTransientErrors,
  type HarnessPlugin,
  type HarnessRunContext
} from '@tanstack/ai-harness'
import {
  permissions,
  question,
  todos,
  usage
} from '@tanstack/ai-harness/plugins'
import {
  workspaceTools,
  type WorkspaceBinder
} from '@tanstack/ai-harness/plugins/coding'
import { boundToolOutput } from '@tanstack/ai-harness/plugins/node'
import { skills } from '@tanstack/ai-skills/harness'
import {
  budgetStop,
  untilABudgetStop,
  workerBudget,
  type ModelPricing
} from '#core/budget/budget'
import type { BudgetLimits } from '#core/budget/limits'
import { WORKER_DURABILITY } from '#core/host/agent-durability'
import { durableCompaction } from '#core/host/durable-compaction'
import { repositoryRulesPrompt } from '#core/prompts/worker'
import {
  workerTelemetry,
  type WorkerObservability
} from '#core/telemetry/worker-telemetry'
import { denyGuard } from './deny-guard.ts'
import type { WorkerLifecycle } from './lifecycle.ts'
import { workerMetadataSchema } from './metadata.ts'
import { SANDBOX_PERMISSION_RULES } from './permission-rules.ts'

export const WORKSPACE_ROOT = '/workspace'

export const WORKER_HARNESS_NAME = 'workcell/worker'

type DefineWorkerHarnessParams = {
  adapter: AnyTextAdapter
  compactionAdapter: AnyTextAdapter
  workspace: WorkspaceBinder
  lifecycle: WorkerLifecycle['plugin']
  skillDirs: readonly string[]
  redactedSecretNames: readonly string[]
  pricing: ModelPricing
  defaultLimits: BudgetLimits
  plugins: readonly HarnessPlugin[]
  observability?: WorkerObservability
}

function requireRedactedSecrets(
  redactedSecretNames: readonly string[]
): ChatMiddleware<HarnessRunContext> {
  return {
    name: 'workcell/require-redacted-secrets',
    onStart: async ({ context }) => {
      await Promise.all(
        redactedSecretNames.map((name) => {
          return context.run.credentials.require(name)
        })
      )
    }
  }
}

export function defineWorkerHarness({
  adapter,
  compactionAdapter,
  workspace,
  lifecycle,
  skillDirs,
  redactedSecretNames,
  pricing,
  defaultLimits,
  plugins,
  observability
}: DefineWorkerHarnessParams) {
  const workerSkills = skills({ dirs: skillDirs })

  return defineHarness({
    name: WORKER_HARNESS_NAME,
    adapter,
    agentLoopStrategy: untilABudgetStop,
    turn: { onModelError: retryTransientErrors() },
    interrupts: [budgetStop],
    systemPrompts: [repositoryRulesPrompt(WORKSPACE_ROOT)],
    metadataSchema: workerMetadataSchema,
    middleware: [requireRedactedSecrets(redactedSecretNames)],
    durability: WORKER_DURABILITY,
    plugins: () => {
      return [
        durableCompaction(compactionAdapter),
        workerTelemetry({ ...observability, pricing }),
        permissions({
          root: WORKSPACE_ROOT,
          rules: SANDBOX_PERMISSION_RULES
        }),
        denyGuard(),
        workspaceTools({ workspace, web: false, outside: 'ask' }),
        boundToolOutput(),
        workerSkills,
        lifecycle,
        question(),
        todos(),
        usage({ model: pricing.modelCost }),
        workerBudget({ pricing, defaultLimits }),
        ...plugins
      ]
    }
  })
}

export type WorkerHarness = ReturnType<typeof defineWorkerHarness>
