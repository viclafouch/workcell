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
} from '#/budget/budget.ts'
import type { BudgetLimits } from '#/budget/limits.ts'
import { WORKER_DURABILITY } from '#/host/agent-durability.ts'
import { durableCompaction } from '#/host/durable-compaction.ts'
import { repositoryRulesPrompt } from '#/prompts/worker.ts'
import { WORKSPACE_ROOT } from '#/sandbox/sandbox-facts.ts'
import { workerMetadataSchema } from '#/session/metadata.ts'
import {
  workerTelemetry,
  type WorkerObservability
} from '#/telemetry/worker-telemetry.ts'
import { denyGuard } from './deny-guard.ts'
import type { WorkerLifecycle } from './lifecycle.ts'
import { SANDBOX_PERMISSION_RULES } from './permission-rules.ts'

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
