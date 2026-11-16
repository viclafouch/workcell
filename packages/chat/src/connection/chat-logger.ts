import type { Logger } from 'chat'

export type LogLine = (
  details: Record<string, unknown>,
  message: string
) => void

export type ChatLogSource = {
  debug: LogLine
  info: LogLine
  warn: LogLine
  error: LogLine
  child: (bindings: Record<string, unknown>) => ChatLogSource
}

function detailsOf(args: readonly unknown[]) {
  const [first] = args

  if (args.length === 1 && first instanceof Error) {
    return { error: first }
  }

  return args.length === 0 ? {} : { details: args }
}

export function toChatLogger(source: ChatLogSource): Logger {
  return {
    child: (prefix) => {
      return toChatLogger(source.child({ chat: prefix }))
    },
    debug: (message, ...args) => {
      source.debug(detailsOf(args), message)
    },
    info: (message, ...args) => {
      source.info(detailsOf(args), message)
    },
    warn: (message, ...args) => {
      source.warn(detailsOf(args), message)
    },
    error: (message, ...args) => {
      source.error(detailsOf(args), message)
    }
  }
}
