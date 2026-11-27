import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { readDevelopmentContext } from '#/server/development-context.ts'
import { HOSTLESS_CONTEXT } from '#/server/hostless-context.ts'

type ServerEntryOptions = Parameters<typeof handler.fetch>[1]

export default createServerEntry({
  async fetch(request, options?: ServerEntryOptions) {
    const context =
      options?.context ?? (await readDevelopmentContext()) ?? HOSTLESS_CONTEXT

    return handler.fetch(request, { ...options, context })
  }
})
