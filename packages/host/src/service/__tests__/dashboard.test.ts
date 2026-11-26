import { describe, expect, it } from 'vitest'
import { createHarnessHost, defineHarness } from '@tanstack/ai-harness'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { fakeText } from '@tanstack/ai/testing'
import type { FeedbackReport, WorkerView } from '@workcell/core'
import { createLogger } from '#/logger.ts'
import { dashboardRoute } from '#/service/dashboard.ts'
import { openHttpLayer } from '#/service/http-layer.ts'
import { liveViewUrl, readLiveView } from '#/service/live-view.ts'

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

const OK = 200

const NOT_FOUND = 404

const METHOD_NOT_ALLOWED = 405

const silentLogger = createLogger({ level: 'silent' })

type OpenDashboardParams = {
  viewWorkers?: () => Promise<WorkerView[]>
  feedback?: FeedbackReport[]
}

async function openServedDashboard({
  viewWorkers = async () => {
    return [WORKER_VIEW]
  },
  feedback = []
}: OpenDashboardParams = {}) {
  const host = createHarnessHost({ persistence: memoryPersistence() })
  const harness = defineHarness({ name: 'test/bot', adapter: fakeText() })
  const route = await dashboardRoute({
    logger: silentLogger,
    workcell: {
      host,
      harness,
      orchestrator: { harness },
      viewWorkers,
      inspectWorkers: viewWorkers,
      readWorkerDiff: async () => {
        return null
      },
      listRecentFeedback: () => {
        return feedback
      }
    }
  })
  const layer = await openHttpLayer({
    operator: { port: 0, routes: [route] },
    logger: silentLogger
  })
  const origin = new URL(layer.operatorUrl ?? '')

  return {
    origin,
    liveView: liveViewUrl(Number(origin.port)),
    [Symbol.asyncDispose]: async () => {
      await layer[Symbol.asyncDispose]()
      await host.close()
    }
  }
}

describe('the dashboard of the host', () => {
  it('serves the view of every running worker from the operator listener', async () => {
    await using dashboard = await openServedDashboard()

    expect(await readLiveView(dashboard.liveView)).toStrictEqual([WORKER_VIEW])
  })

  it('serves the page shell for any page of the app', async () => {
    await using dashboard = await openServedDashboard()

    const response = await fetch(
      new URL('/workers/live-thread', dashboard.origin)
    )

    expect(response.status).toBe(OK)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('answers 404 to a file it does not hold, and keeps crawlers away', async () => {
    await using dashboard = await openServedDashboard()

    const robots = await fetch(new URL('/robots.txt', dashboard.origin))
    const unknownFile = await fetch(new URL('/llms.txt', dashboard.origin))

    expect(await robots.text()).toContain('Disallow: /')
    expect(unknownFile.status).toBe(NOT_FOUND)
  })

  it('answers 405 to a write on any route', async () => {
    await using dashboard = await openServedDashboard()

    const paths = [
      '/',
      '/api/workers',
      '/api/harness/worker/control',
      '/assets/x.js'
    ]
    const statuses = await Promise.all(
      paths.map(async (path) => {
        const response = await fetch(new URL(path, dashboard.origin), {
          method: 'POST'
        })

        return response.status
      })
    )

    expect(statuses).toStrictEqual(
      paths.map(() => {
        return METHOD_NOT_ALLOWED
      })
    )
  })

  it('refuses the read that opens a session', async () => {
    await using dashboard = await openServedDashboard()

    const response = await fetch(
      new URL(
        '/api/harness/worker/describe?threadId=live-thread',
        dashboard.origin
      )
    )

    expect(response.status).toBe(NOT_FOUND)
  })

  it('tells a stopped host apart from a failed view', async () => {
    const dashboard = await openServedDashboard({
      viewWorkers: async () => {
        throw new Error('The view failed.')
      }
    })

    await expect(readLiveView(dashboard.liveView)).rejects.toThrow(
      'The live view answered 500.'
    )

    await dashboard[Symbol.asyncDispose]()

    expect(await readLiveView(dashboard.liveView)).toBeNull()
  })
})
