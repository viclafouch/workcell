import { formatWithOptions } from 'node:util'
import { LogLevel, type Logger as BoltLogger } from '@slack/bolt'

export type LogLine = (
  details: Record<string, unknown>,
  message: string
) => void

type BoltLog = Record<'debug' | 'info' | 'warn' | 'error', LogLine> & {
  level: string
  setBindings: (bindings: Record<string, unknown>) => void
}

export type BoltLogSource = {
  child: (bindings: Record<string, unknown>) => BoltLog
}

const SLACK_CREDENTIAL = /\b(?:xox[a-z]|xapp)-[\w-]+|\bticket=[^&\s'"]+/gu

const BOLT_LEVELS = new Map([
  ['trace', LogLevel.DEBUG],
  ['debug', LogLevel.DEBUG],
  ['info', LogLevel.INFO],
  ['warn', LogLevel.WARN],
  ['error', LogLevel.ERROR],
  ['fatal', LogLevel.ERROR],
  ['silent', LogLevel.ERROR]
])

function toMessage(parts: unknown[]) {
  return formatWithOptions({ breakLength: Infinity }, ...parts).replaceAll(
    SLACK_CREDENTIAL,
    '[redacted]'
  )
}

function keepTheHostLevel() {}

export function toBoltLogger(logger: BoltLogSource): BoltLogger {
  const slackLogger = logger.child({})

  return {
    debug: (...parts) => {
      slackLogger.debug({}, toMessage(parts))
    },
    info: (...parts) => {
      slackLogger.info({}, toMessage(parts))
    },
    warn: (...parts) => {
      slackLogger.warn({}, toMessage(parts))
    },
    error: (...parts) => {
      slackLogger.error({}, toMessage(parts))
    },
    setLevel: keepTheHostLevel,
    getLevel: () => {
      return BOLT_LEVELS.get(slackLogger.level) ?? LogLevel.INFO
    },
    setName: (name) => {
      slackLogger.setBindings({ name })
    }
  }
}
