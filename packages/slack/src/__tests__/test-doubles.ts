import type { LogLine } from '#/connection/bolt-logger.ts'

type SilentLog = Record<'debug' | 'info' | 'warn' | 'error', LogLine> & {
  level: string
  setBindings: (bindings: Record<string, unknown>) => void
  child: (bindings: Record<string, unknown>) => SilentLog
}

function ignore() {}

export const SILENT_SLACK_LOGGER: SilentLog = {
  level: 'silent',
  debug: ignore,
  info: ignore,
  warn: ignore,
  error: ignore,
  setBindings: ignore,
  child: () => {
    return SILENT_SLACK_LOGGER
  }
}
