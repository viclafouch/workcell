import type { AnyTextAdapter } from '@tanstack/ai'
import {
  defineHarness,
  definePlugin,
  retryTransientErrors,
  type HarnessPlugin
} from '@tanstack/ai-harness'
import { permissions, usage } from '@tanstack/ai-harness/plugins'
import {
  workspaceTools,
  type WorkspaceBinder
} from '@tanstack/ai-harness/plugins/coding'
import { boundToolOutput } from '@tanstack/ai-harness/plugins/node'
import {
  untilABudgetStop,
  workerBudget,
  type ModelPricing
} from '#/budget/budget.ts'
import type { BudgetLimits } from '#/budget/limits.ts'
import { AGENT_DURABILITY } from '#/host/agent-durability.ts'
import type { IsStarter } from '#/host/allowed-senders.ts'
import { durableCompaction } from '#/host/durable-compaction.ts'
import { libraryMapPrompt, orchestratorPrompt } from '#/prompts/orchestrator.ts'
import {
  workerTelemetry,
  type WorkerObservability
} from '#/telemetry/worker-telemetry.ts'
import { agentMetadataSchema } from '#/workers/metadata.ts'
import type { Workers } from '#/workers/workers.ts'
import { orchestratorTools } from './orchestrator-tools.ts'

const ORCHESTRATOR_HARNESS_NAME = 'workcell/orchestrator'

type OrchestratorLibrary = {
  root: string
  workspace: WorkspaceBinder
  map: () => string
}

type DefineOrchestratorHarnessParams = {
  name: string
  adapter: AnyTextAdapter
  compactionAdapter: AnyTextAdapter
  library: OrchestratorLibrary
  workers: Workers
  isStarter: IsStarter
  repositories: readonly string[]
  pricing: ModelPricing
  limits: BudgetLimits
  plugins: readonly HarnessPlugin[]
  observability?: WorkerObservability
}

function libraryMap(map: () => string) {
  return definePlugin({
    name: 'workcell/library-map',
    setup: () => {
      return {
        prompts: [
          () => {
            return libraryMapPrompt(map())
          }
        ]
      }
    }
  })
}

export function defineOrchestratorHarness({
  name,
  adapter,
  compactionAdapter,
  library,
  workers,
  isStarter,
  repositories,
  pricing,
  limits,
  plugins,
  observability
}: DefineOrchestratorHarnessParams) {
  return defineHarness({
    name: ORCHESTRATOR_HARNESS_NAME,
    adapter,
    agentLoopStrategy: untilABudgetStop,
    turn: { onModelError: retryTransientErrors() },
    metadataSchema: agentMetadataSchema,
    systemPrompts: [
      orchestratorPrompt({ name, libraryRoot: library.root, repositories })
    ],
    durability: AGENT_DURABILITY,
    plugins: () => {
      return [
        durableCompaction(compactionAdapter),
        workerTelemetry({ ...observability, pricing }),
        permissions({ root: library.root }),
        workspaceTools({ workspace: library.workspace, web: false }),
        boundToolOutput(),
        libraryMap(library.map),
        orchestratorTools({ workers, isStarter, repositories }),
        usage({ model: pricing.modelCost }),
        workerBudget({
          pricing,
          defaultLimits: limits,
          agentName: name,
          onLimit: 'end'
        }),
        ...plugins
      ]
    }
  })
}

export type OrchestratorHarness = ReturnType<typeof defineOrchestratorHarness>
