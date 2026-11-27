import type { Tracer } from '@opentelemetry/api'
import type { HarnessHost } from '@tanstack/ai-harness'
import {
  spentUsdOf,
  type ModelPricing,
  type TaskSpending
} from '#/budget/budget.ts'
import type { TaskEnd, WorkerMetadata } from '#/session/metadata.ts'
import { taskAttributes } from '#/telemetry/worker-telemetry.ts'
import type { NamedWorker, WorkerLog } from './lifecycle.ts'
import type { WorkerSandbox } from './worker-sandbox.ts'

type IndexEntry = { metadata?: WorkerMetadata }

type IndexEntryUpdate = (current: IndexEntry) => IndexEntry

export type WorkerEnd = {
  worker: NamedWorker
  report?: string
  outcome: TaskEnd
  spending: TaskSpending
  updateIndexEntry: (
    update: IndexEntryUpdate
  ) => Promise<IndexEntry | undefined>
}

type FinishStep = { name: string; run: () => Promise<void> }

type FinishStepsParams = WorkerEnd & {
  pricing: Pick<ModelPricing, 'costOfUsage'>
  tracer: Tracer
  log: WorkerLog
  destroySandbox: () => Promise<void>
  workerSandbox: Pick<WorkerSandbox, 'forget'>
  host: HarnessHost
  freePlace: () => void
}

export function finishSteps({
  worker,
  report,
  outcome,
  spending,
  updateIndexEntry,
  pricing,
  tracer,
  log,
  destroySandbox,
  workerSandbox,
  host,
  freePlace
}: FinishStepsParams): FinishStep[] {
  return [
    {
      name: 'outcome',
      run: async () => {
        const entry = await updateIndexEntry((current) => {
          if (current.metadata === undefined) {
            return {}
          }

          const recorded = current.metadata.outcome
          const taskOutcome =
            recorded?.value === outcome.value
              ? recorded
              : {
                  ...outcome,
                  costUsd: spentUsdOf(pricing, spending),
                  changedAt: Temporal.Now.instant().epochMilliseconds
                }

          return {
            metadata: { ...current.metadata, report, outcome: taskOutcome }
          }
        })
        const taskOutcome = entry?.metadata?.outcome

        if (taskOutcome === undefined) {
          return
        }

        log.info({ report, outcome: taskOutcome }, 'worker outcome')
        tracer
          .startSpan('workcell.task.outcome', {
            attributes: {
              ...taskAttributes(worker.threadId, entry?.metadata),
              'workcell.task.outcome': taskOutcome.value,
              'workcell.task.outcome.cause': taskOutcome.cause,
              'workcell.task.cost_usd': taskOutcome.costUsd
            }
          })
          .end()
      }
    },
    { name: 'destroy-sandbox', run: destroySandbox },
    {
      name: 'forget-changes',
      run: async () => {
        await workerSandbox.forget(worker)
      }
    },
    {
      name: 'archive',
      run: async () => {
        await host.sessions.archive({ threadId: worker.threadId })
        log.info({}, 'worker finished')
        freePlace()
      }
    }
  ]
}
