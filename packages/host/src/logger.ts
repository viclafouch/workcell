import {
  pino,
  transport,
  type DestinationStream,
  type LevelWithSilent,
  type Logger,
  type LoggerOptions
} from 'pino'

export type { Logger }

const SECRET_KEYS = [
  'token',
  'apiKey',
  'authorization',
  'Authorization',
  'x-api-key',
  'password',
  'secret',
  'modelKey',
  'ANTHROPIC_API_KEY',
  'GH_TOKEN'
]

const LOG_FILE_MAX_SIZE = '10m'

const ROLLED_LOG_FILES_KEPT = 5

export type CreateLoggerParams = {
  destination?: DestinationStream
  level?: LevelWithSilent
  file?: string
  secretKeys?: readonly string[]
}

function toRedactedPaths(secretKeys: readonly string[]) {
  return [...SECRET_KEYS, ...secretKeys].flatMap((key) => {
    const segment = /^\w+$/u.test(key) ? `.${key}` : `["${key}"]`

    return [`["${key}"]`, `*${segment}`, `*.*${segment}`, `*.*.*${segment}`]
  })
}

function rollingFile(file: string) {
  return transport({
    target: 'pino-roll',
    options: {
      file,
      size: LOG_FILE_MAX_SIZE,
      limit: { count: ROLLED_LOG_FILES_KEPT, removeOtherLogFiles: true },
      mkdir: true,
      symlink: true
    }
  })
}

export function createLogger({
  destination,
  level = 'info',
  file,
  secretKeys = []
}: CreateLoggerParams = {}): Logger {
  const options: LoggerOptions = {
    level,
    redact: { paths: toRedactedPaths(secretKeys), censor: '[redacted]' },
    serializers: { error: pino.stdSerializers.err }
  }

  if (destination) {
    return pino(options, destination)
  }

  if (file !== undefined) {
    return pino(options, rollingFile(file))
  }

  if (process.stdout.isTTY) {
    return pino(options, transport({ target: 'pino-pretty' }))
  }

  return pino(options)
}
