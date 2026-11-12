import { z } from 'zod'
import type { HarnessSession } from '@tanstack/ai-harness'

export type LogLine = (
  details: Record<string, unknown>,
  message: string
) => void

type ServerLogger = { info: LogLine; warn: LogLine }

const mcpStateSchema = z.object({
  plugins: z.object({
    'tanstack/mcp': z.object({
      servers: z.array(
        z.object({
          name: z.string(),
          status: z.enum(['connecting', 'connected', 'reconnecting', 'failed']),
          error: z.string().optional()
        })
      )
    })
  })
})

export function logMcpServerChanges(
  session: HarnessSession,
  log: ServerLogger
) {
  const statuses = new Map<string, string>()

  const logChanges = (state: unknown) => {
    const parsed = mcpStateSchema.safeParse(state)

    if (!parsed.success) {
      return
    }

    for (const { name, status, error } of parsed.data.plugins['tanstack/mcp']
      .servers) {
      if (status === 'connecting' || statuses.get(name) === status) {
        continue
      }

      statuses.set(name, status)

      if (status === 'connected') {
        log.info({ server: name, status }, 'mcp server')
      } else {
        log.warn({ server: name, status, error }, 'mcp server')
      }
    }
  }

  const stopListening = session.onEvent('STATE_SNAPSHOT', ({ event }) => {
    logChanges(event.snapshot)
  })
  logChanges(session.snapshot())

  return stopListening
}
