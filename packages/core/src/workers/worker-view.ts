import { z } from 'zod'
import type { HarnessHost, PendingWait } from '@tanstack/ai-harness'
import type { ModelPricing } from '#/budget/budget.ts'
import type { SandboxFacts } from '#/sandbox/sandbox-facts.ts'
import type { WorkerSandbox } from '#/sandbox/worker-sandbox.ts'
import type { WorkerHarness } from './harness.ts'
import type { WorkerLifecycle } from './lifecycle.ts'
import type { ListedWorker } from './live-workers.ts'
import type { TurnActivity, WorkerActivity } from './worker-activity.ts'

export const workerViewSchema = z.object({
  threadId: z.string(),
  name: z.string(),
  repository: z.string(),
  subject: z.string().optional(),
  phase: z.enum(['setup', 'queued', 'model', 'tool', 'waiting', 'idle']),
  command: z.string().optional(),
  turnUsd: z.number().optional(),
  spentUsd: z.number(),
  branch: z.string().optional(),
  sandbox: z
    .object({
      diff: z.string(),
      untrackedFiles: z.number(),
      memoryBytes: z.number().optional(),
      memoryMaxBytes: z.number().optional()
    })
    .optional()
})

export type WorkerView = z.infer<typeof workerViewSchema>

type WorkerFacts = {
  worker: ListedWorker
  activity: TurnActivity | undefined
  isQueued: boolean
  pendingWaits: readonly Pick<PendingWait, 'turn'>[]
  spentUsd: number
  sandbox: SandboxFacts | null
}

type CreateWorkerViewParams = {
  host: HarnessHost
  harness: WorkerHarness
  lifecycle: Pick<WorkerLifecycle, 'isQueued'>
  activity: Pick<WorkerActivity, 'activityOf'>
  workerSandbox: Pick<WorkerSandbox, 'inspect'>
  pricing: Pick<ModelPricing, 'costOfUsage'>
}

function phaseOf({
  activity,
  isQueued,
  pendingWaits
}: Pick<WorkerFacts, 'activity' | 'isQueued' | 'pendingWaits'>) {
  if (activity !== undefined) {
    return isQueued ? 'queued' : activity.phase
  }

  return pendingWaits.some(({ turn }) => {
    return turn === true
  })
    ? 'waiting'
    : 'idle'
}

export function workerViewOf(facts: WorkerFacts): WorkerView {
  const { worker, activity, spentUsd, sandbox } = facts

  return {
    threadId: worker.threadId,
    name: worker.name,
    repository: worker.repository,
    subject: worker.subject,
    phase: phaseOf(facts),
    command: activity?.command,
    turnUsd: activity?.turnUsd,
    spentUsd,
    branch: sandbox?.branch ?? worker.branch,
    sandbox:
      sandbox === null
        ? undefined
        : {
            diff: sandbox.diff,
            untrackedFiles: sandbox.untrackedFiles,
            memoryBytes: sandbox.memoryBytes,
            memoryMaxBytes: sandbox.memoryMaxBytes
          }
  }
}

export function createWorkerView({
  host,
  harness,
  lifecycle,
  activity,
  workerSandbox,
  pricing
}: CreateWorkerViewParams) {
  const viewOf = async (worker: ListedWorker) => {
    const { threadId } = worker
    const observed = await host.observe(harness, { threadId })
    const [{ pendingWaits }, usage, sandbox] = await Promise.all([
      observed.snapshot(),
      observed.usage(),
      workerSandbox.inspect(threadId)
    ])

    return workerViewOf({
      worker,
      activity: activity.activityOf(threadId),
      isQueued: lifecycle.isQueued(threadId),
      pendingWaits,
      spentUsd: pricing.costOfUsage(usage),
      sandbox
    })
  }

  return async (workers: readonly ListedWorker[]) => {
    return Promise.all(workers.map(viewOf))
  }
}
