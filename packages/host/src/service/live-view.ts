import { z } from 'zod'
import { workerViewSchema, type WorkerView } from '@workcell/core'
import { type HttpRoute, LOOPBACK } from './http-layer.ts'

const WORKERS_PATH = '/workers'

const METHOD_NOT_ALLOWED = 405

export function liveViewUrl(port: number) {
  return `http://${LOOPBACK}:${port}${WORKERS_PATH}`
}

export function liveViewRoute(
  viewWorkers: () => Promise<WorkerView[]>
): HttpRoute {
  return {
    path: WORKERS_PATH,
    fetch: async (request) => {
      if (request.method !== 'GET') {
        return new Response(null, {
          status: METHOD_NOT_ALLOWED,
          headers: { allow: 'GET' }
        })
      }

      return Response.json(await viewWorkers())
    }
  }
}

export async function readLiveView(url: string) {
  const response = await fetch(url).catch(() => {
    return null
  })

  if (response === null) {
    return null
  }

  if (!response.ok) {
    throw new Error(`The live view answered ${response.status}.`)
  }

  return z.array(workerViewSchema).parse(await response.json())
}
