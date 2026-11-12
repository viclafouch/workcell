import type { Logger as TanStackLogger } from '@tanstack/ai'
import type { LogLine } from './mcp-server-log.ts'

export type LeveledLog = Record<'debug' | 'info' | 'warn' | 'error', LogLine>

export function toTanStackLogger(log: LeveledLog): TanStackLogger {
  return {
    debug: (message, meta = {}) => {
      log.debug(meta, message)
    },
    info: (message, meta = {}) => {
      log.info(meta, message)
    },
    warn: (message, meta = {}) => {
      log.warn(meta, message)
    },
    error: (message, meta = {}) => {
      log.error(meta, message)
    }
  }
}
