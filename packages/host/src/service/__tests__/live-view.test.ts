import { describe, expect, it } from 'vitest'
import type { WorkerView } from '@workcell/core'
import { createLogger } from '#/logger.ts'
import { openHttpLayer } from '#/service/http-layer.ts'
import {
  liveViewRoute,
  liveViewUrl,
  readLiveView
} from '#/service/live-view.ts'

const WORKER_VIEW: WorkerView = {
  threadId: 'live-thread',
  name: 'Alpha',
  repository: 'acme/app',
  topic: 'TASK-7',
  phase: 'tool',
  command: 'pnpm test',
  turnUsd: 0.4,
  spentUsd: 1.5,
  budgetUsd: 5,
  branch: 'task-7-fix',
  pullRequest: 'https://example.com/acme/app/pull/7',
  waits: []
}

const silentLogger = createLogger({ level: 'silent' })

async function openLiveView(viewWorkers: () => Promise<WorkerView[]>) {
  const layer = await openHttpLayer({
    operator: { port: 0, routes: [liveViewRoute(viewWorkers)] },
    logger: silentLogger
  })

  return {
    url: liveViewUrl(Number(new URL(layer.operatorUrl ?? '').port)),
    [Symbol.asyncDispose]: layer[Symbol.asyncDispose]
  }
}

describe('the live view of the host', () => {
  it('serves the view of every running worker from the operator listener', async () => {
    await using live = await openLiveView(async () => {
      return [WORKER_VIEW]
    })

    expect(await readLiveView(live.url)).toStrictEqual([WORKER_VIEW])
  })

  it('tells a stopped host apart from a failed view', async () => {
    await using live = await openLiveView(async () => {
      throw new Error('The view failed.')
    })

    await expect(readLiveView(live.url)).rejects.toThrow(
      'The live view answered 500.'
    )

    await live[Symbol.asyncDispose]()

    expect(await readLiveView(live.url)).toBeNull()
  })
})
