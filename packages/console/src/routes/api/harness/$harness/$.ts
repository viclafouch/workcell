import { createFileRoute } from '@tanstack/react-router'
import { HARNESS_NAMES } from '#/server/console-context.ts'
import { notFound } from '#/server/responses.ts'

const OPENS_A_SESSION = new Set(['describe'])

const matchIsHarnessName = (
  value: string
): value is (typeof HARNESS_NAMES)[number] => {
  return HARNESS_NAMES.some((name) => {
    return name === value
  })
}

export const Route = createFileRoute('/api/harness/$harness/$')({
  server: {
    handlers: {
      GET: ({ request, params, context }) => {
        const operation = new URL(request.url).pathname.split('/').at(-1) ?? ''

        if (
          !matchIsHarnessName(params.harness) ||
          OPENS_A_SESSION.has(operation)
        ) {
          return notFound()
        }

        return context.harness[params.harness](request)
      }
    }
  }
})
