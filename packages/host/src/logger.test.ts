import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { chat, streamToText } from '@tanstack/ai'
import { fakeText } from '@tanstack/ai/testing'
import { toTanStackLogger } from '@workcell/core'
import { createLogger } from './logger.ts'

const SECRET = 'npm_0123456789abcdef'

const SECRET_KEYS = [
  'MODEL_API_KEY',
  'NPM_TOKEN',
  'DATABASE_URL',
  'GITHUB_TOKEN'
]

const logRecord = z.looseObject({ level: z.number(), msg: z.string() })

function captureLines() {
  const lines: string[] = []
  const destination = {
    write: (line: string) => {
      lines.push(line)
    }
  }
  const readRecords = () => {
    return lines.map((line) => {
      return logRecord.parse(JSON.parse(line))
    })
  }

  return { lines, destination, readRecords }
}

const ROLLED_FILE_WAIT = { timeout: 5_000 }

describe('createLogger', () => {
  it.each([
    { token: SECRET },
    { env: { MODEL_API_KEY: SECRET } },
    { env: { NPM_TOKEN: SECRET } },
    { request: { headers: { authorization: `Bearer ${SECRET}` } } },
    { request: { headers: { Authorization: `Bearer ${SECRET}` } } },
    { request: { headers: { 'x-api-key': SECRET } } },
    { config: { request: { headers: { authorization: SECRET } } } },
    { linear: { apiKey: SECRET } },
    { models: { modelKey: SECRET } },
    {
      store: { DATABASE_URL: `postgres://agent:${SECRET}@db.example.com/agent` }
    }
  ])('keeps the secret of %o out of the output', (payload) => {
    const { lines, destination } = captureLines()

    createLogger({ destination, secretKeys: SECRET_KEYS }).info(
      payload,
      'secret payload'
    )

    expect(lines).toHaveLength(1)
    expect(lines.join('')).not.toContain(SECRET)
  })

  it('writes to the current log file of its folder', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'host-logs-'))
    onTestFinished(async () => {
      await rm(folder, { recursive: true, force: true })
    })

    createLogger({ file: join(folder, 'host.log') }).info(
      { token: SECRET },
      'The host is ready.'
    )

    await vi.waitFor(async () => {
      const written = await readFile(join(folder, 'current.log'), 'utf8')

      expect(written).toContain('The host is ready.')
      expect(written).not.toContain(SECRET)
    }, ROLLED_FILE_WAIT)
  })

  it('writes the lines at its level and above', () => {
    const { destination, readRecords } = captureLines()
    const warnLogger = createLogger({ destination, level: 'warn' })

    warnLogger.info('hidden')
    warnLogger.warn('shown')

    expect(readRecords()).toMatchObject([{ msg: 'shown' }])
  })
})

describe('a child logger', () => {
  it('writes its bindings on each line and keeps the secrets out', () => {
    const { destination, readRecords } = captureLines()
    const workerLogger = createLogger({
      destination,
      secretKeys: SECRET_KEYS
    }).child({
      module: 'agents',
      threadId: 'thread-1',
      worker: 'Alpha'
    })

    workerLogger.info({ env: { GITHUB_TOKEN: SECRET } }, 'clone the repository')

    expect(readRecords()).toMatchObject([
      {
        module: 'agents',
        threadId: 'thread-1',
        worker: 'Alpha',
        env: { GITHUB_TOKEN: '[redacted]' },
        msg: 'clone the repository'
      }
    ])
  })
})

describe('toTanStackLogger', () => {
  it('sends each TanStack level to pino with its meta, secrets redacted', () => {
    const { lines, destination, readRecords } = captureLines()
    const tanStackLogger = toTanStackLogger(
      createLogger({ destination, level: 'debug' })
    )

    tanStackLogger.debug('[tanstack-ai:provider] chunk', { chunk: 'delta' })
    tanStackLogger.info('[tanstack-ai:request] activity=chat', {
      config: { headers: { authorization: SECRET } }
    })
    tanStackLogger.warn('[tanstack-ai:config] changed')
    tanStackLogger.error('[tanstack-ai:errors] run failed', {
      error: new Error('The provider is down')
    })

    expect(lines.join('')).not.toContain(SECRET)
    expect(readRecords()).toMatchObject([
      { level: 20, msg: '[tanstack-ai:provider] chunk', chunk: 'delta' },
      { level: 30, msg: '[tanstack-ai:request] activity=chat' },
      { level: 40, msg: '[tanstack-ai:config] changed' },
      {
        level: 50,
        msg: '[tanstack-ai:errors] run failed',
        error: { message: 'The provider is down' }
      }
    ])
  })

  it('receives the debug output of a chat run', async () => {
    const { destination, readRecords } = captureLines()
    const fake = fakeText()
    fake.setResponses([{ text: 'Hello!' }])

    await streamToText(
      chat({
        adapter: fake,
        messages: [{ role: 'user', content: 'Hi' }],
        threadId: 'thread-1',
        debug: {
          logger: toTanStackLogger(
            createLogger({ destination, level: 'debug' })
          )
        }
      })
    )

    const messages = readRecords().map(({ msg }) => {
      return msg
    })

    expect(messages).toContainEqual(
      expect.stringContaining('[tanstack-ai:request]')
    )
  })
})
