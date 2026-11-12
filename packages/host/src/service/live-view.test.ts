import { describe, expect, it, vi } from 'vitest'
import type { WorkerView } from '@workcell/core'
import { createLogger } from '#host/logger'
import { liveViewUrl, openLiveView, readLiveView } from './live-view.ts'

const WORKER_VIEW: WorkerView = {
  threadId: 'live-thread',
  name: 'Alpha',
  repository: 'acme/app',
  subject: 'TASK-7',
  phase: 'tool',
  command: 'pnpm test',
  turnUsd: 0.4,
  spentUsd: 1.5,
  branch: 'task-7-fix'
}

const silentLogger = createLogger({ level: 'silent' })

async function openOnFreePort(viewWorkers: () => Promise<WorkerView[]>) {
  const server = await openLiveView({
    port: 0,
    viewWorkers,
    logger: silentLogger
  })
  const address = server.address()

  if (address === null || typeof address === 'string') {
    throw new Error('The live view listens on no port.')
  }

  return {
    url: liveViewUrl(address.port),
    close: async () => {
      await server[Symbol.asyncDispose]()
    },
    [Symbol.asyncDispose]: async () => {
      if (server.listening) {
        await server[Symbol.asyncDispose]()
      }
    }
  }
}

describe('the live view of the host', () => {
  it('serves the view of every running worker on the loopback', async () => {
    const viewWorkers = vi.fn(async () => {
      return [WORKER_VIEW]
    })
    await using live = await openOnFreePort(viewWorkers)

    expect(await readLiveView(live.url)).toStrictEqual([WORKER_VIEW])
    expect(viewWorkers).toHaveBeenCalledTimes(1)
  })

  it('tells a stopped host apart from a failed view', async () => {
    await using live = await openOnFreePort(async () => {
      throw new Error('The view failed.')
    })

    await expect(readLiveView(live.url)).rejects.toThrow(
      'The live view answered 500.'
    )

    await live.close()

    expect(await readLiveView(live.url)).toBeNull()
  })
})
