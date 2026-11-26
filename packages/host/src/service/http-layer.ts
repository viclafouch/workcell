import { type Server, serve, type ServerMiddleware } from 'srvx'
import {
  hostHeaderValidationResponse,
  localhostAllowedHostnames
} from '@modelcontextprotocol/server'
import { StartRefusalError } from '@workcell/core'

export const LOOPBACK = '127.0.0.1'

const NOT_FOUND = 404

const INTERNAL_SERVER_ERROR = 500

export type HttpRoute = {
  path: `/${string}`
  fetch: (request: Request) => Response | Promise<Response>
}

type ListenerName = 'operator' | 'webhook'

type ListenerSettings = {
  port: number
  routes: readonly HttpRoute[]
}

type WebhookListenerSettings = ListenerSettings & { hostname?: string }

type HttpLayerParams = {
  logger: { error: (bindings: object, message: string) => void }
  operator?: ListenerSettings
  webhook?: WebhookListenerSettings
}

type ListenerParams = {
  name: ListenerName
  port: number
  hostname: string
  routes: readonly HttpRoute[]
  guardsOwnSite: boolean
  logger: HttpLayerParams['logger']
}

export class PortInUseError extends StartRefusalError {
  readonly listener: ListenerName

  readonly port: number

  constructor(listener: ListenerName, port: number) {
    super(
      `The ${listener} listener cannot bind port ${port}: something else holds it. Stop it, or set another port, then start again.`
    )
    this.name = 'PortInUseError'
    this.listener = listener
    this.port = port
  }

  get details() {
    return { listener: this.listener, port: this.port }
  }
}

const refuseForeignHosts: ServerMiddleware = (request, next) => {
  return (
    hostHeaderValidationResponse(request, localhostAllowedHostnames()) ?? next()
  )
}

function isPortInUse(error: unknown) {
  return (
    error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
  )
}

function matchesPath(path: HttpRoute['path'], pathname: string) {
  return path === '/' || pathname === path || pathname.startsWith(`${path}/`)
}

function routerOf(routes: readonly HttpRoute[]) {
  const paths = new Set<string>()

  for (const { path } of routes) {
    if (paths.has(path)) {
      throw new Error(`Two HTTP routes share the path ${path}.`)
    }

    paths.add(path)
  }

  const byLongestPath = routes.toSorted((first, second) => {
    return second.path.length - first.path.length
  })

  return (pathname: string) => {
    return byLongestPath.find(({ path }) => {
      return matchesPath(path, pathname)
    })
  }
}

async function openListener({
  name,
  port,
  hostname,
  routes,
  guardsOwnSite,
  logger
}: ListenerParams) {
  const routeOf = routerOf(routes)
  const server: Server = serve({
    port,
    hostname,
    manual: true,
    silent: true,
    gracefulShutdown: false,
    middleware: guardsOwnSite ? [refuseForeignHosts] : [],
    fetch: (request) => {
      const route = routeOf(new URL(request.url).pathname)

      if (route === undefined) {
        return new Response(null, { status: NOT_FOUND })
      }

      return route.fetch(request)
    },
    error: (error) => {
      logger.error({ error, listener: name }, 'An HTTP route failed.')

      return new Response(null, { status: INTERNAL_SERVER_ERROR })
    }
  })
  try {
    await server.serve()
  } catch (error) {
    if (isPortInUse(error)) {
      throw new PortInUseError(name, port)
    }

    throw error
  }

  return server
}

export async function openHttpLayer({
  operator,
  webhook,
  logger
}: HttpLayerParams) {
  await using listeners = new AsyncDisposableStack()
  const open = async (params: Omit<ListenerParams, 'logger'>) => {
    if (params.routes.length === 0) {
      return
    }

    const server = await openListener({ ...params, logger })
    listeners.defer(async () => {
      await server.close(true)
    })

    return server.url
  }
  const operatorUrl =
    operator &&
    (await open({
      name: 'operator',
      port: operator.port,
      hostname: LOOPBACK,
      routes: operator.routes,
      guardsOwnSite: true
    }))
  const webhookUrl =
    webhook &&
    (await open({
      name: 'webhook',
      port: webhook.port,
      hostname: webhook.hostname ?? LOOPBACK,
      routes: webhook.routes,
      guardsOwnSite: false
    }))
  const opened = listeners.move()

  return {
    operatorUrl,
    webhookUrl,
    [Symbol.asyncDispose]: async () => {
      await opened.disposeAsync()
    }
  }
}
