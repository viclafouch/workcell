import { once } from 'node:events'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http'
import { z } from 'zod'
import { workerViewSchema, type WorkerView } from '@workcell/core'

const LOOPBACK = '127.0.0.1'

const WORKERS_PATH = '/workers'

const OK = 200

const NOT_FOUND = 404

const INTERNAL_SERVER_ERROR = 500

export function liveViewUrl(port: number) {
  return `http://${LOOPBACK}:${port}${WORKERS_PATH}`
}

type LiveViewParams = {
  port: number
  viewWorkers: () => Promise<WorkerView[]>
  logger: { error: (bindings: object, message: string) => void }
}

export async function openLiveView({
  port,
  viewWorkers,
  logger
}: LiveViewParams) {
  const answer = async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'GET' || request.url !== WORKERS_PATH) {
      response.writeHead(NOT_FOUND).end()

      return
    }

    try {
      const workers = await viewWorkers()
      response
        .writeHead(OK, { 'content-type': 'application/json' })
        .end(JSON.stringify(workers))
    } catch (error) {
      logger.error({ error }, 'live view not built')
      response.writeHead(INTERNAL_SERVER_ERROR).end()
    }
  }
  const server = createServer((request, response) => {
    void answer(request, response)
  })
  server.listen(port, LOOPBACK)
  await once(server, 'listening')

  return server
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
