import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { staticMiddleware } from 'srvx/static'
import { StartRefusalError } from '@workcell/core'
import { DEFAULT_BRAND_NAME } from '#/constants/brand.ts'
import type { DashboardContext } from './dashboard-context.ts'
import { methodNotAllowed, notFound, READ_METHODS } from './responses.ts'
import {
  brandOf,
  brandShellOf,
  createBrandServer,
  matchIsBrandPath,
  type DashboardBrandOptions
} from './serve-brand.ts'

export type { DashboardBrandOptions } from './serve-brand.ts'

export type {
  DashboardBrand,
  DashboardContext,
  DashboardLogger,
  HarnessName
} from './dashboard-context.ts'

const PACKAGE_ROOT = new URL('../../', import.meta.url)

const CLIENT_DIRECTORY = new URL('dist/client/', PACKAGE_ROOT)

const SERVER_ENTRY = new URL('dist/server/server.js', PACKAGE_ROOT)

const SHELL = new URL('_shell.html', CLIENT_DIRECTORY)

const BUILD_COMMAND = 'pnpm --filter @workcell/dashboard build'

const ASSETS_PATH = '/assets/'

const PUBLIC_FILES = new Set(['/favicon.svg', '/robots.txt'])

const ROOT_FILE_PATH = /^\/[^/]+\.[a-z0-9]+$/iu

const SERVER_PATHS = ['/api/', '/_serverFn/']

const YEAR_IN_SECONDS = 31_536_000

const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
  'cross-origin-opener-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff'
}

type ServerEntry = {
  fetch: (
    request: Request,
    options: { context: DashboardContext }
  ) => Promise<Response>
}

export class DashboardNotBuiltError extends StartRefusalError {
  readonly buildCommand = BUILD_COMMAND

  constructor() {
    super(
      `The dashboard has no build to serve. Run \`${BUILD_COMMAND}\`, then start the host again.`
    )
    this.name = 'DashboardNotBuiltError'
  }

  get details() {
    return { buildCommand: this.buildCommand }
  }
}

export type OpenDashboardParams = Omit<DashboardContext, 'brand'> & {
  brand?: DashboardBrandOptions
}

const DEFAULT_BRAND: DashboardBrandOptions = { name: DEFAULT_BRAND_NAME }

const matchIsReadable = async (file: URL) => {
  try {
    await access(file)

    return true
  } catch {
    return false
  }
}

const matchIsServerModule = (
  value: unknown
): value is { default: ServerEntry } => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'default' in value &&
    typeof value.default === 'object' &&
    value.default !== null &&
    'fetch' in value.default &&
    typeof value.default.fetch === 'function'
  )
}

const loadServerEntry = async () => {
  if (!(await matchIsReadable(SERVER_ENTRY))) {
    throw new DashboardNotBuiltError()
  }

  const serverModule: unknown = await import(SERVER_ENTRY.href)

  if (!matchIsServerModule(serverModule)) {
    throw new DashboardNotBuiltError()
  }

  return serverModule.default
}

const withSecurityHeaders = (response: Response) => {
  const headers = new Headers(response.headers)

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value)
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

export const openDashboard = async ({
  brand: brandOptions = DEFAULT_BRAND,
  ...context
}: OpenDashboardParams) => {
  const [entry, defaultShell] = await Promise.all([
    loadServerEntry(),
    readFile(SHELL, 'utf8')
  ])
  const shell = brandShellOf(defaultShell, brandOptions)
  const requestContext: DashboardContext = {
    ...context,
    brand: brandOf(brandOptions)
  }
  const serveBrand = createBrandServer(brandOptions)
  const serveAsset = staticMiddleware({
    dir: fileURLToPath(CLIENT_DIRECTORY),
    maxAge: YEAR_IN_SECONDS,
    immutable: true
  })
  const servePublicFile = staticMiddleware({
    dir: fileURLToPath(CLIENT_DIRECTORY)
  })
  const respond = async (request: Request) => {
    const { pathname } = new URL(request.url)

    if (
      SERVER_PATHS.some((path) => {
        return pathname.startsWith(path)
      })
    ) {
      return entry.fetch(request, { context: requestContext })
    }

    if (!READ_METHODS.includes(request.method)) {
      return methodNotAllowed()
    }

    if (pathname.startsWith(ASSETS_PATH)) {
      return serveAsset(request, notFound)
    }

    if (PUBLIC_FILES.has(pathname)) {
      return servePublicFile(request, notFound)
    }

    if (matchIsBrandPath(pathname)) {
      return serveBrand(request)
    }

    if (ROOT_FILE_PATH.test(pathname) || pathname.startsWith('/.well-known/')) {
      return notFound()
    }

    return new Response(shell, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-cache'
      }
    })
  }

  return async (request: Request) => {
    return withSecurityHeaders(await respond(request))
  }
}
