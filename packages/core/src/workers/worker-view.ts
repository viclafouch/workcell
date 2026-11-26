import { z } from 'zod'
import type { HarnessHost, PendingWait, WaitKind } from '@tanstack/ai-harness'
import { scrubSecrets } from '@tanstack/ai/byok'
import {
  budgetStateOf,
  spentUsdOf,
  type ModelPricing
} from '#/budget/budget.ts'
import { taskOutcomeSchema, type TaskOutcome } from '#/session/metadata.ts'
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
  topic: z.string(),
  phase: z.enum([
    'setup',
    'queued',
    'model',
    'tool',
    'waiting',
    'idle',
    'finished'
  ]),
  command: z.string().optional(),
  turnUsd: z.number().optional(),
  spentUsd: z.number(),
  budgetUsd: z.number().optional(),
  branch: z.string().optional(),
  pullRequest: z.string().optional(),
  waits: z.array(
    z.custom<WaitKind>((value) => {
      return typeof value === 'string'
    })
  ),
  startupMs: z.number().optional(),
  outcome: taskOutcomeSchema.omit({ costUsd: true }).optional(),
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

type InspectedSandbox = SandboxInSetup | SandboxReady | null

type WorkerFacts = {
  worker: ListedWorker
  activity: TurnActivity | undefined
  isQueued: boolean
  isInSetup: boolean
  pendingWaits: readonly Pick<PendingWait, 'turn' | 'kind'>[]
  spentUsd: number
  budgetUsd: number | undefined
}

type FinishedWorker = ListedWorker & { outcome: TaskOutcome }

type CreateWorkerViewParams = {
  host: HarnessHost
  harness: WorkerHarness
  readWorkers: () => Promise<ListedWorker[]>
  readFinishedWorkers: () => Promise<FinishedWorker[]>
  lifecycle: Pick<WorkerLifecycle, 'isQueued'>
  activity: Pick<WorkerActivity, 'activityOf'>
  workerSandbox: Pick<WorkerSandbox, 'isInSetup' | 'inspect' | 'readDiff'>
  pricing: Pick<ModelPricing, 'costOfUsage'>
  secretValues: readonly string[]
}

export function firstLine(text: string) {
  return text.split('\n')[0] ?? text
}

function phaseOf({
  activity,
  isQueued,
  isInSetup,
  pendingWaits
}: WorkerFacts): WorkerView['phase'] {
  if (isInSetup) {
    return 'setup'
  }

  if (isQueued) {
    return 'queued'
  }

  if (activity !== undefined) {
    return activity.phase
  }

  return pendingWaits.some(({ turn }) => {
    return turn === true
  })
    ? 'waiting'
    : 'idle'
}

function sandboxViewOf(sandbox: InspectedSandbox): WorkerView['sandbox'] {
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
  const { worker, activity, pendingWaits, spentUsd, budgetUsd } = facts

  return {
    threadId: worker.threadId,
    name: worker.name,
    repository: worker.repository,
    topic: worker.subject ?? firstLine(worker.task),
    phase: phaseOf(facts),
    command: activity?.command,
    turnUsd: activity?.turnUsd,
    spentUsd,
    budgetUsd,
    branch: worker.branch,
    pullRequest: worker.pullRequest,
    waits: pendingWaits.map(({ kind }) => {
      return kind
    }),
    startupMs: worker.startupMs
  }
}

export function finishedWorkerViewOf({
  outcome: { costUsd, ...outcome },
  ...worker
}: FinishedWorker): WorkerView {
  return {
    threadId: worker.threadId,
    name: worker.name,
    repository: worker.repository,
    topic: worker.subject ?? firstLine(worker.task),
    phase: 'finished',
    spentUsd: costUsd,
    branch: worker.branch,
    pullRequest: worker.pullRequest,
    waits: [],
    startupMs: worker.startupMs,
    outcome
  }
}

export function withSandboxView(
  view: WorkerView,
  sandbox: InspectedSandbox
): WorkerView {
  return {
    ...view,
    sandbox: sandboxViewOf(sandbox)
  }
}

export function createWorkerView({
  host,
  harness,
  readWorkers,
  readFinishedWorkers,
  lifecycle,
  activity,
  workerSandbox,
  pricing,
  secretValues
}: CreateWorkerViewParams) {
  const viewOf = async (worker: ListedWorker) => {
    const { threadId } = worker
    const observed = await host.observe(harness, { threadId })
    const { pendingWaits, plugins, usage } = await observed.snapshot()
    const budget = budgetStateOf(plugins)

    return workerViewOf({
      worker,
      activity: activity.activityOf(threadId),
      isQueued: lifecycle.isQueued(threadId),
      isInSetup: workerSandbox.isInSetup(threadId),
      pendingWaits,
      spentUsd: spentUsdOf(pricing, { usage, plugins }),
      budgetUsd: budget?.capUsd
    })
  }

  const viewLiveWorkers = async () => {
    const workers = await readWorkers()

    return Promise.all(workers.map(viewOf))
  }

  const viewFinishedWorkers = async () => {
    const workers = await readFinishedWorkers()

    return workers.map(finishedWorkerViewOf)
  }

  const withFinishedWorkers = async (liveViews: Promise<WorkerView[]>) => {
    const [live, finished] = await Promise.all([
      liveViews,
      viewFinishedWorkers()
    ])

    return [...live, ...finished]
  }

  const inspectLiveWorkers = async () => {
    const views = await viewLiveWorkers()

    return Promise.all(
      views.map(async (view) => {
        return withSandboxView(view, await workerSandbox.inspect(view.threadId))
      })
    )
  }

  const viewWorkers = async () => {
    return withFinishedWorkers(viewLiveWorkers())
  }

  const inspectWorkers = async () => {
    return withFinishedWorkers(inspectLiveWorkers())
  }

  const readWorkerDiff = async (threadId: string) => {
    const diff = await workerSandbox.readDiff(threadId)

    return diff === null ? null : scrubSecrets(diff, secretValues)
  }

  return { viewWorkers, inspectWorkers, readWorkerDiff }
}

export type ViewWorkers = ReturnType<typeof createWorkerView>['viewWorkers']
