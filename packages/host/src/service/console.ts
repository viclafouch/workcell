import { randomBytes } from 'node:crypto'
import type { AnyHarness, HarnessHost } from '@tanstack/ai-harness'
import { createHarnessHandler } from '@tanstack/ai-harness/server'
import {
  openConsole,
  type ConsoleBrandOptions,
  type ConsoleChat,
  type ConsoleLogger,
  type WorkerIdentity
} from '@workcell/console'
import type { openWorkcell, TicketQueue } from '@workcell/core'
import type { HttpRoute } from './http-layer.ts'

const OPERATOR = { id: 'operator' }

const MEDIA_KEY_BYTES = 32

type Workcell = Awaited<ReturnType<typeof openWorkcell>>

export type ConsoleWorkcell = Pick<
  Workcell,
  | 'host'
  | 'harness'
  | 'viewWorkers'
  | 'inspectWorkers'
  | 'readWorkerDiff'
  | 'listRecentFeedback'
> & { orchestrator: Pick<Workcell['orchestrator'], 'harness'> }

export type ConsoleOptions = {
  brand?: ConsoleBrandOptions
  chats?: readonly ConsoleChat[]
  workerIdentities?: readonly WorkerIdentity[]
  queue?: TicketQueue
  traceUrl?: (threadId: string) => string
}

type ConsoleRouteParams = ConsoleOptions & {
  workcell: ConsoleWorkcell
  logger: ConsoleLogger
}

const handlerOf = (host: HarnessHost, harness: AnyHarness) => {
  return createHarnessHandler({
    host,
    harness,
    openAccess: { user: OPERATOR },
    media: { secret: randomBytes(MEDIA_KEY_BYTES).toString('hex') }
  })
}

export async function consoleRoute({
  workcell,
  ...options
}: ConsoleRouteParams): Promise<HttpRoute> {
  const fetch = await openConsole({
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
