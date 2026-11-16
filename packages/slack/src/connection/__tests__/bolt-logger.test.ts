import { describe, expect, it } from 'vitest'
import { LogLevel } from '@slack/bolt'
import { toBoltLogger, type BoltLogSource } from '#/connection/bolt-logger.ts'

const BOT_TOKEN = 'xoxb-1234-5678-abcdefghijkl'

const APP_TOKEN = 'xapp-1-A0123-4567-abcdef0123'

const SOCKET_URL =
  'wss://wss-primary.slack.com/link/?ticket=7a1c2b3d-0000-4abc&app_id=A0123'

type LogRecord = Record<string, unknown> & { level: string; msg: string }

type RecordingLog = ReturnType<BoltLogSource['child']> & {
  child: (bindings: Record<string, unknown>) => RecordingLog
}

function recordingLog(
  records: LogRecord[],
  level: string,
  bindings: Record<string, unknown>
): RecordingLog {
  const writeAt = (recordLevel: string) => {
    return (details: Record<string, unknown>, msg: string) => {
      records.push({ ...bindings, ...details, level: recordLevel, msg })
    }
  }

  return {
    level,
    debug: writeAt('debug'),
    info: writeAt('info'),
    warn: writeAt('warn'),
    error: writeAt('error'),
    setBindings: (more) => {
      Object.assign(bindings, more)
    },
    child: (more) => {
      return recordingLog(records, level, { ...bindings, ...more })
    }
  }
}

function captureRecords(level = 'debug') {
  const records: LogRecord[] = []
  const hostLogger = recordingLog(records, level, {})

  return {
    boltLogger: toBoltLogger(hostLogger.child({ module: 'slack' })),
    records
  }
}

describe('toBoltLogger', () => {
  it('writes each Bolt line as one message of the host logger', () => {
    const { boltLogger, records } = captureRecords()

    boltLogger.info('Now connected to Slack', { attempt: 2 })

    expect(records).toStrictEqual([
      {
        module: 'slack',
        level: 'info',
        msg: 'Now connected to Slack { attempt: 2 }'
      }
    ])
  })

  it.each([
    ['a bot token', `token=${BOT_TOKEN}`, BOT_TOKEN],
    ['an app token', { token: APP_TOKEN }, APP_TOKEN],
    [
      'a Socket Mode ticket',
      `Connecting to ${SOCKET_URL}`,
      '7a1c2b3d-0000-4abc'
    ]
  ])('keeps %s out of the output', (_name, payload, secret) => {
    const { boltLogger, records } = captureRecords()

    boltLogger.warn('Slack said', payload)

    expect(records).toHaveLength(1)
    expect(JSON.stringify(records)).not.toContain(secret)
  })

  it('keeps the host level when a Slack library sets its own, and takes its name', () => {
    const { boltLogger, records } = captureRecords('warn')

    boltLogger.setName('socket-mode')
    boltLogger.setLevel(LogLevel.DEBUG)
    boltLogger.warn('shown at warn')

    expect(boltLogger.getLevel()).toBe(LogLevel.WARN)
    expect(records).toMatchObject([
      { msg: 'shown at warn', name: 'socket-mode' }
    ])
  })
})
