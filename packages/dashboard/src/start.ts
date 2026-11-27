import { SpanStatusCode, trace } from '@opentelemetry/api'
import {
  createCsrfMiddleware,
  createMiddleware,
  createStart
} from '@tanstack/react-start'
import type { DashboardContext } from '#/server/dashboard-context.ts'
import { methodNotAllowed, READ_METHODS } from '#/server/responses.ts'

const TRACER_NAME = '@workcell/dashboard'

const readOnlyMiddleware = createMiddleware().server(({ request, next }) => {
  if (!READ_METHODS.includes(request.method)) {
    return methodNotAllowed()
  }

  return next()
})

const csrfMiddleware = createCsrfMiddleware({
  filter: ({ request }) => {
    return request.headers.get('sec-fetch-dest') !== 'document'
  },
  allowRequestsWithoutOriginCheck: true
})

const INTERNAL_SERVER_ERROR = 500

const tracingMiddleware = createMiddleware().server(
  ({ request, context, next, serverFnMeta }) => {
    const { pathname } = new URL(request.url)
    const target = serverFnMeta?.name ?? pathname

    return trace
      .getTracer(TRACER_NAME)
      .startActiveSpan(`${request.method} ${target}`, async (span) => {
        span.setAttributes({
          'http.request.method': request.method,
          'url.path': pathname,
          ...(serverFnMeta === undefined
            ? {}
            : { 'code.function.name': serverFnMeta.name })
        })

        try {
          const result = await next()
          span.setAttribute('http.response.status_code', result.response.status)

          return result
        } catch (error) {
          span.recordException(error instanceof Error ? error : String(error))
          span.setStatus({ code: SpanStatusCode.ERROR })
          if (!request.signal.aborted) {
            context.logger.error(
              { error, path: pathname },
              'A dashboard request failed.'
            )
          }

          return new Response(null, { status: INTERNAL_SERVER_ERROR })
        } finally {
          span.end()
        }
      })
  }
)

export const startInstance = createStart(() => {
  return {
    requestMiddleware: [readOnlyMiddleware, csrfMiddleware, tracingMiddleware]
  }
})

declare module '@tanstack/react-router' {
  // oxlint-disable-next-line consistent-type-definitions -- a module augmentation needs an interface
  interface Register {
    server: {
      requestContext: DashboardContext
    }
  }
}
