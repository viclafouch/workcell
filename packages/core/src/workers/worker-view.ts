import { z } from 'zod'
import type { HarnessHost, PendingWait } from '@tanstack/ai-harness'
import type { ModelPricing } from '#/budget/budget.ts'
import type { WorkerHarness } from './harness.ts'
import type { WorkerLifecycle } from './lifecycle.ts'
import type { ListedWorker } from './live-workers.ts'
import type { TurnActivity, WorkerActivity } from './worker-activity.ts'
import type {
  SandboxInSetup,
  SandboxReady,
  WorkerSandbox
} from './worker-sandbox.ts'

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
  startupMs: z.number().optional(),
  sandbox: z
    .discriminatedUnion('state', [
      z.object({
        state: z.literal('setup'),
        id: z.string().optional(),
        step: z.enum(['create', 'clone', 'setup', 'restore', 'bind']),
        commands: z.array(z.string()).optional(),
        elapsedMs: z.number()
      }),
      z.object({
        state: z.literal('ready'),
        id: z.string(),
        diff: z.string(),
        untrackedFiles: z.number(),
        memoryBytes: z.number().optional(),
        memoryMaxBytes: z.number().optional()
      })
    ])
    .optional()
})

export type WorkerView = z.infer<typeof workerViewSchema>

type WorkerFacts = {
  worker: ListedWorker
  activity: TurnActivity | undefined
  isQueued: boolean
  pendingWaits: readonly Pick<PendingWait, 'turn'>[]
  spentUsd: number
  sandbox: SandboxInSetup | SandboxReady | null
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
  pendingWaits,
  sandbox
}: Omit<WorkerFacts, 'worker' | 'spentUsd'>) {
  if (sandbox?.state === 'setup') {
    return 'setup'
  }

  if (activity !== undefined) {
    return isQueued ? 'queued' : activity.phase
  }

  return pendingWaits.some(({ turn }) => {
    return turn === true
  })
    ? 'waiting'
    : 'idle'
}

function sandboxViewOf(sandbox: WorkerFacts['sandbox']): WorkerView['sandbox'] {
  if (sandbox === null) {
    return undefined
  }

  if (sandbox.state === 'setup') {
    return {
      state: 'setup',
      id: sandbox.id,
      step: sandbox.step,
      commands: 'commands' in sandbox ? sandbox.commands : undefined,
      elapsedMs: sandbox.elapsedMs
    }
  }

  return {
    state: 'ready',
    id: sandbox.id,
    diff: sandbox.diff,
    untrackedFiles: sandbox.untrackedFiles,
    memoryBytes: sandbox.memoryBytes,
    memoryMaxBytes: sandbox.memoryMaxBytes
  }
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
    branch:
      (sandbox?.state === 'ready' ? sandbox.branch : undefined) ??
      worker.branch,
    startupMs: worker.startupMs,
    sandbox: sandboxViewOf(sandbox)
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
