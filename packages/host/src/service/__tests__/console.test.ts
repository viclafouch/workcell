import { describe, expect, it } from 'vitest'
import { createHarnessHost, defineHarness } from '@tanstack/ai-harness'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { fakeText } from '@tanstack/ai/testing'
import type { FeedbackReport, WorkerView } from '@workcell/core'
import { createLogger } from '#/logger.ts'
import { consoleRoute, type ConsoleOptions } from '#/service/console.ts'
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

type OpenConsoleParams = {
  viewWorkers?: () => Promise<WorkerView[]>
  feedback?: FeedbackReport[]
  brand?: ConsoleOptions['brand']
}

async function openServedConsole({
  viewWorkers = async () => {
    return [WORKER_VIEW]
  },
  feedback = [],
  brand
}: OpenConsoleParams = {}) {
  const host = createHarnessHost({ persistence: memoryPersistence() })
  const harness = defineHarness({ name: 'test/bot', adapter: fakeText() })
  const route = await consoleRoute({
    logger: silentLogger,
    brand,
    workcell: {
      host,
      harness,
      orchestrator: { harness },
      viewWorkers,
      inspectWorkers: viewWorkers,
      readWorkerDiff: async () => {
        return null
      },
      listRecentFeedback: async () => {
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

describe('the console of the host', () => {
  it('serves the view of every running worker from the operator listener', async () => {
    await using servedConsole = await openServedConsole()

    expect(await readLiveView(servedConsole.liveView)).toStrictEqual([
      WORKER_VIEW
    ])
  })

  it('serves the page shell for any page of the app', async () => {
    await using servedConsole = await openServedConsole()

    const response = await fetch(
      new URL('/workers/live-thread', servedConsole.origin)
    )

    expect(response.status).toBe(OK)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('serves the page shell for a thread whose id holds a dot', async () => {
    await using servedConsole = await openServedConsole()

    const response = await fetch(
      new URL('/threads/chat%3AC01%3A1795716657.721509', servedConsole.origin)
    )

    expect(response.status).toBe(OK)
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('answers 404 to a file it does not hold, and keeps crawlers away', async () => {
    await using servedConsole = await openServedConsole()

    const robots = await fetch(new URL('/robots.txt', servedConsole.origin))
    const statuses = await Promise.all(
      ['/llms.txt', '/assets/missing.js'].map(async (path) => {
        const response = await fetch(new URL(path, servedConsole.origin))

        return response.status
      })
    )

    expect(await robots.text()).toContain('Disallow: /')
    expect(statuses).toStrictEqual([NOT_FOUND, NOT_FOUND])
  })

  it('paints the brand from the first frame: its title and its stylesheets sit in the served shell', async () => {
    await using servedConsole = await openServedConsole({
      brand: {
        name: 'Acme <Bot>',
        stylesheets: [new URL(import.meta.url)]
      }
    })

    const response = await fetch(servedConsole.origin)
    const shell = await response.text()

    expect(shell).toContain('<title>Acme &lt;Bot&gt;: what runs now</title>')
    expect(shell).toContain(
      "@import url('/brand/stylesheets/0.css') layer(brand);"
    )
  })

  it('answers 405 to a write on any route', async () => {
    await using servedConsole = await openServedConsole()

    const paths = [
      '/',
      '/api/workers',
      '/api/harness/worker/control',
      '/assets/x.js'
    ]
    const statuses = await Promise.all(
      paths.map(async (path) => {
        const response = await fetch(new URL(path, servedConsole.origin), {
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
    await using servedConsole = await openServedConsole()

    const response = await fetch(
      new URL(
        '/api/harness/worker/describe?threadId=live-thread',
        servedConsole.origin
      )
    )

    expect(response.status).toBe(NOT_FOUND)
  })

  it('tells a stopped host apart from a failed view', async () => {
    const servedConsole = await openServedConsole({
      viewWorkers: async () => {
        throw new Error('The view failed.')
      }
    })

    await expect(readLiveView(servedConsole.liveView)).rejects.toThrow(
      'The live view answered 500.'
    )

    await servedConsole[Symbol.asyncDispose]()

    expect(await readLiveView(servedConsole.liveView)).toBeNull()
  })
})
