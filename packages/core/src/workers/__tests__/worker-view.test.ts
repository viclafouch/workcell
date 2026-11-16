import { describe, expect, it } from 'vitest'
import type { PendingWait } from '@tanstack/ai-harness'
import type { ListedWorker } from '#/workers/live-workers.ts'
import type { TurnActivity } from '#/workers/worker-activity.ts'
import { workerViewOf } from '#/workers/worker-view.ts'

const WORKER: ListedWorker = {
  threadId: 'view-thread',
  updatedAt: 1,
  name: 'Alpha',
  task: 'Fix the ticket.',
  repository: 'acme/app',
  subject: 'TASK-1',
  branch: 'task-1-fix'
}

const RUNNING_TOOL: TurnActivity = {
  operationId: 'operation-1',
  phase: 'tool',
  command: 'pnpm test',
  turnUsd: 0.4
}

const TURN_WAIT: Pick<PendingWait, 'turn'> = { turn: true }

type ViewCase = {
  name: string
  activity: TurnActivity | undefined
  isQueued: boolean
  pendingWaits: Pick<PendingWait, 'turn'>[]
  phase: string
}

const PHASE_CASES: ViewCase[] = [
  {
    name: 'a running turn',
    activity: RUNNING_TOOL,
    isQueued: false,
    pendingWaits: [],
    phase: 'tool'
  },
  {
    name: 'a turn that waits for a free slot',
    activity: RUNNING_TOOL,
    isQueued: true,
    pendingWaits: [],
    phase: 'queued'
  },
  {
    name: 'a worker that waits for a person',
    activity: undefined,
    isQueued: false,
    pendingWaits: [TURN_WAIT],
    phase: 'waiting'
  },
  {
    name: 'a sleeping worker',
    activity: undefined,
    isQueued: false,
    pendingWaits: [],
    phase: 'idle'
  }
]

describe('the view of a worker', () => {
  it.each(PHASE_CASES)(
    'shows the phase of $name',
    ({ activity, isQueued, pendingWaits, phase }) => {
      const view = workerViewOf({
        worker: WORKER,
        activity,
        isQueued,
        pendingWaits,
        spentUsd: 1.5,
        sandbox: null
      })

      expect(view.phase).toBe(phase)
    }
  )

  it('shows the branch and the diff of the sandbox over the saved branch', () => {
    const view = workerViewOf({
      worker: WORKER,
      activity: RUNNING_TOOL,
      isQueued: false,
      pendingWaits: [],
      spentUsd: 1.5,
      sandbox: {
        branch: 'task-1-other',
        diff: '1 file changed, 2 insertions(+)',
        untrackedFiles: 0,
        memoryBytes: 1024,
        memoryMaxBytes: 2048
      }
    })

    expect(view).toStrictEqual({
      threadId: 'view-thread',
      name: 'Alpha',
      repository: 'acme/app',
      subject: 'TASK-1',
      phase: 'tool',
      command: 'pnpm test',
      turnUsd: 0.4,
      spentUsd: 1.5,
      branch: 'task-1-other',
      sandbox: {
        diff: '1 file changed, 2 insertions(+)',
        untrackedFiles: 0,
        memoryBytes: 1024,
        memoryMaxBytes: 2048
      }
    })
  })
})
