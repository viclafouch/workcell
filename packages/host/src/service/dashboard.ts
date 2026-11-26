import { randomBytes } from 'node:crypto'
import type { AnyHarness, HarnessHost } from '@tanstack/ai-harness'
import { createHarnessHandler } from '@tanstack/ai-harness/server'
import type { openWorkcell } from '@workcell/core'
import {
  openDashboard,
  type DashboardBrandOptions,
  type DashboardLogger
} from '@workcell/dashboard'
import type { HttpRoute } from './http-layer.ts'

const OPERATOR = { id: 'operator' }

const MEDIA_KEY_BYTES = 32

type Workcell = Awaited<ReturnType<typeof openWorkcell>>

export type DashboardWorkcell = Pick<
  Workcell,
  | 'host'
  | 'harness'
  | 'viewWorkers'
  | 'inspectWorkers'
  | 'readWorkerDiff'
  | 'listRecentFeedback'
> & { orchestrator: Pick<Workcell['orchestrator'], 'harness'> }

export type DashboardOptions = {
  brand?: DashboardBrandOptions
  traceUrl?: (threadId: string) => string
}

type DashboardRouteParams = DashboardOptions & {
  workcell: DashboardWorkcell
  logger: DashboardLogger
}

const handlerOf = (host: HarnessHost, harness: AnyHarness) => {
  return createHarnessHandler({
    host,
    harness,
    openAccess: { user: OPERATOR },
    media: { secret: randomBytes(MEDIA_KEY_BYTES).toString('hex') }
  })
}

export async function dashboardRoute({
  workcell,
  ...options
}: DashboardRouteParams): Promise<HttpRoute> {
  const fetch = await openDashboard({
    ...options,
    harness: {
      worker: handlerOf(workcell.host, workcell.harness),
      bot: handlerOf(workcell.host, workcell.orchestrator.harness)
    },
    workers: {
      view: workcell.viewWorkers,
      inspect: workcell.inspectWorkers,
      diff: workcell.readWorkerDiff
    },
    feedback: { recent: workcell.listRecentFeedback }
  })

  return { path: '/', fetch }
}
