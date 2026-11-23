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
import { skills } from '@tanstack/ai-skills/harness'
import {
  untilABudgetStop,
  workerBudget,
  type ModelPricing
} from '#/budget/budget.ts'
import type { BudgetLimits } from '#/budget/limits.ts'
import { AGENT_DURABILITY } from '#/host/agent-durability.ts'
import type { IsStarter } from '#/host/allowed-senders.ts'
import { durableCompaction } from '#/host/durable-compaction.ts'
import {
  DEFAULT_ORCHESTRATOR_SCOPE,
  libraryMapPrompt,
  orchestratorPrompt
} from '#/prompts/orchestrator.ts'
import { agentMetadataSchema } from '#/session/metadata.ts'
import {
  workerTelemetry,
  type WorkerObservability
} from '#/telemetry/worker-telemetry.ts'
import { WEB_FETCH_RULE } from '#/workers/permission-rules.ts'
import type { ViewWorkers } from '#/workers/worker-view.ts'
import type { Workers } from '#/workers/workers.ts'
import { orchestratorTools } from './orchestrator-tools.ts'
import { starterOnlyGuard } from './starter-only-tools.ts'

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
  viewWorkers: ViewWorkers
  isStarter: IsStarter
  repositories: readonly string[]
  pricing: ModelPricing
  limits: BudgetLimits
  plugins: readonly HarnessPlugin[]
  scope?: string
  skillDirs?: readonly string[]
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
  scope = DEFAULT_ORCHESTRATOR_SCOPE,
  adapter,
  compactionAdapter,
  library,
  workers,
  viewWorkers,
  isStarter,
  repositories,
  pricing,
  limits,
  plugins,
  skillDirs = [],
  observability
}: DefineOrchestratorHarnessParams) {
  const orchestratorSkills = skills({ dirs: skillDirs })

  return defineHarness({
    name: ORCHESTRATOR_HARNESS_NAME,
    adapter,
    agentLoopStrategy: untilABudgetStop,
    turn: { onModelError: retryTransientErrors() },
    metadataSchema: agentMetadataSchema,
    systemPrompts: [
      orchestratorPrompt({
        name,
        scope,
        libraryRoot: library.root,
        repositories
      })
    ],
    durability: AGENT_DURABILITY,
    plugins: () => {
      return [
        durableCompaction(compactionAdapter),
        workerTelemetry({ ...observability, pricing }),
        permissions({ root: library.root, rules: [WEB_FETCH_RULE] }),
        workspaceTools({ workspace: library.workspace }),
        boundToolOutput(),
        libraryMap(library.map),
        orchestratorTools({
          workers,
          viewWorkers,
          isStarter,
          repositories
        }),
        starterOnlyGuard(isStarter),
        orchestratorSkills,
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
