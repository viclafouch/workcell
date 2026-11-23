import { describe, expect, it } from 'vitest'
import type { PendingWait } from '@tanstack/ai-harness'
import type { ListedWorker } from '#/workers/live-workers.ts'
import type { TurnActivity } from '#/workers/worker-activity.ts'
import { withSandboxView, workerViewOf } from '#/workers/worker-view.ts'

const WORKER: ListedWorker = {
  threadId: 'view-thread',
  updatedAt: 1,
  name: 'Alpha',
  task: 'Fix the ticket.\nThen open a pull request.',
  repository: 'acme/app',
  branch: 'task-1-fix',
  pullRequest: 'https://example.com/acme/app/pull/7'
}

const RUNNING_TOOL: TurnActivity = {
  operationId: 'operation-1',
  phase: 'tool',
  command: 'pnpm test',
  turnUsd: 0.4
}

const TURN_WAIT: Pick<PendingWait, 'turn' | 'kind'> = {
  turn: true,
  kind: 'question'
}

type ViewCase = {
  name: string
  activity: TurnActivity | undefined
  isQueued: boolean
  isInSetup: boolean
  pendingWaits: Pick<PendingWait, 'turn' | 'kind'>[]
  phase: string
}

const PHASE_CASES: ViewCase[] = [
  {
    name: 'a worker that sets up its sandbox',
    activity: undefined,
    isQueued: false,
    isInSetup: true,
    pendingWaits: [],
    phase: 'setup'
  },
  {
    name: 'a running turn',
    activity: RUNNING_TOOL,
    isQueued: false,
    isInSetup: false,
    pendingWaits: [],
    phase: 'tool'
  },
  {
    name: 'a turn that waits for a free slot',
    activity: undefined,
    isQueued: true,
    isInSetup: false,
    pendingWaits: [],
    phase: 'queued'
  },
  {
    name: 'a worker that waits for a person',
    activity: undefined,
    isQueued: false,
    isInSetup: false,
    pendingWaits: [TURN_WAIT],
    phase: 'waiting'
  },
  {
    name: 'a sleeping worker',
    activity: undefined,
    isQueued: false,
    isInSetup: false,
    pendingWaits: [],
    phase: 'idle'
  }
]

function viewOf(facts: Partial<Parameters<typeof workerViewOf>[0]> = {}) {
  return workerViewOf({
    worker: WORKER,
    activity: RUNNING_TOOL,
    isQueued: false,
    isInSetup: false,
    pendingWaits: [],
    spentUsd: 1.5,
    budgetUsd: 5,
    ...facts
  })
}

describe('the view of a worker', () => {
  it.each(PHASE_CASES)(
    'shows the phase of $name',
    ({ activity, isQueued, isInSetup, pendingWaits, phase }) => {
      expect(
        viewOf({ activity, isQueued, isInSetup, pendingWaits }).phase
      ).toBe(phase)
    }
  )

  it('shows the spend against the budget, the pull request and the open waits, with the first line of the task as its topic', () => {
    expect(viewOf({ pendingWaits: [TURN_WAIT] })).toStrictEqual({
      threadId: 'view-thread',
      name: 'Alpha',
      repository: 'acme/app',
      topic: 'Fix the ticket.',
      phase: 'tool',
      command: 'pnpm test',
      turnUsd: 0.4,
      spentUsd: 1.5,
      budgetUsd: 5,
      branch: 'task-1-fix',
      pullRequest: 'https://example.com/acme/app/pull/7',
      waits: ['question'],
      startupMs: undefined
    })
  })

  it('adds the sandbox to the live view, and keeps the saved branch that list_workers shows', () => {
    const view = withSandboxView(viewOf(), {
      state: 'ready',
      id: 'sandbox-1',
      branch: 'task-1-other',
      diff: '1 file changed, 2 insertions(+)',
      untrackedFiles: 0,
      memoryBytes: 1024,
      memoryMaxBytes: 2048
    })

    expect(view).toMatchObject({
      branch: 'task-1-fix',
      sandbox: {
        state: 'ready',
        id: 'sandbox-1',
        diff: '1 file changed, 2 insertions(+)',
        untrackedFiles: 0,
        memoryBytes: 1024,
        memoryMaxBytes: 2048
      }
    })
  })
})
