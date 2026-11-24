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
import { renderCatalog, type SkillSource } from '@tanstack/ai-skills'
import { skills } from '@tanstack/ai-skills/harness'
import {
  budgetStop,
  untilABudgetStop,
  workerBudget,
  type ModelPricing
} from '#/budget/budget.ts'
import type { BudgetLimits } from '#/budget/limits.ts'
import { feedback, type FeedbackOptions } from '#/feedback/feedback.ts'
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
import {
  SANDBOX_DENIALS,
  SANDBOX_PERMISSION_RULES,
  WEB_FETCH_RULE
} from './permission-rules.ts'
import { workerSubagent } from './subagent.ts'

export const WORKER_HARNESS_NAME = 'workcell/worker'

type DefineWorkerHarnessParams = {
  adapter: AnyTextAdapter
  compactionAdapter: AnyTextAdapter
  subagentAdapter: AnyTextAdapter
  workspace: WorkspaceBinder
  lifecycle: WorkerLifecycle['plugin']
  skills: { dirs: readonly string[]; sources: readonly SkillSource[] }
  redactedSecretNames: readonly string[]
  pricing: ModelPricing
  defaultLimits: BudgetLimits
  plugins: readonly HarnessPlugin[]
  feedback?: FeedbackOptions
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
  subagentAdapter,
  workspace,
  lifecycle,
  skills: { dirs, sources },
  redactedSecretNames,
  pricing,
  defaultLimits,
  plugins,
  feedback: feedbackOptions,
  observability
}: DefineWorkerHarnessParams) {
  const workerSkills = skills({ dirs, sources, renderCatalog })

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
    subagents: { agents: [], background: false },
    plugins: () => {
      return [
        durableCompaction(compactionAdapter),
        workerTelemetry({ ...observability, pricing }),
        permissions({
          root: WORKSPACE_ROOT,
          rules: [...SANDBOX_PERMISSION_RULES, WEB_FETCH_RULE]
        }),
        denyGuard(SANDBOX_DENIALS),
        workspaceTools({ workspace, outside: 'ask' }),
        boundToolOutput(),
        workerSkills,
        lifecycle,
        question(),
        todos(),
        usage({ model: pricing.modelCost }),
        workerBudget({ pricing, defaultLimits }),
        feedback({ ...feedbackOptions, harness: WORKER_HARNESS_NAME }),
        ...plugins,
        workerSubagent({ adapter: subagentAdapter, pricing })
      ]
    }
  })
}

export type WorkerHarness = ReturnType<typeof defineWorkerHarness>
