import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { definePlugin } from '@tanstack/ai-harness'
import { createMigratedDatabase } from '#/testing/test-database.ts'
import { TEST_STARTER } from '#/testing/test-doubles.ts'
import {
  WorkerSandboxSetup,
  type WorkerSandboxSetupEvent
} from '#/workers/worker-sandbox.ts'
import { createOrigin, loggedLines, REPOSITORY } from './worker-fixtures.ts'
import {
  closeWorkerTestbed,
  openWorkers,
  openWorkerTestbed
} from './worker-testbed.ts'

const stepLineSchema = z.tuple([
  z.object({
    threadId: z.string(),
    step: z.string(),
    commands: z.array(z.string()).optional(),
    durationMs: z.number().nonnegative().optional(),
    error: z.unknown().optional()
  }),
  z.string()
])

function setupStepLines(threadId: string) {
  return loggedLines.flatMap((line) => {
    const [details, message] = stepLineSchema
      .catch([{ threadId: '', step: '' }, ''])
      .parse(JSON.parse(line))

    if (details.threadId !== threadId || !message.startsWith('sandbox step')) {
      return []
    }

    return [
      {
        message,
        step: details.step,
        commands: details.commands,
        timed: details.durationMs !== undefined,
        failed: details.error !== undefined
      }
    ]
  })
}

function stepLine(
  message: string,
  step: string,
  {
    commands,
    timed = message !== 'sandbox step started',
    failed = false
  }: {
    commands?: string[]
    timed?: boolean
    failed?: boolean
  } = {}
) {
  return { message, step, commands, timed, failed }
}

function recordSetupEvents() {
  const events: WorkerSandboxSetupEvent[] = []
  const plugin = definePlugin({
    name: 'test/record-sandbox-setup',
    setup: (setupContext) => {
      setupContext.on(WorkerSandboxSetup, (event) => {
        events.push(event)
      })

      return {}
    }
  })

  return { events, plugin }
}

describe('the setup of a worker sandbox', () => {
  let origin: Awaited<ReturnType<typeof createOrigin>>

  beforeAll(async () => {
    await openWorkerTestbed()
  })

  beforeEach(async () => {
    origin = await createOrigin()

    return async () => {
      await origin.destroy()
    }
  })

  afterAll(closeWorkerTestbed)

  it('logs the start and the end of each step with its duration and the thread of the worker, and tells the worker plugins', async () => {
    const url = await createMigratedDatabase()
    const recorded = recordSetupEvents()
    await using agent = await openWorkers(url, [{ text: 'Done.' }], {
      originUrl: origin.url,
      setup: ['true', 'echo ready'],
      plugins: [recorded.plugin]
    })

    const worker = await agent.workers.startWorker({
      starter: TEST_STARTER,
      repository: REPOSITORY,
      task: 'Say done.'
    })
    await worker.firstTurn

    expect(setupStepLines(worker.threadId)).toStrictEqual([
      stepLine('sandbox step started', 'create'),
      stepLine('sandbox step ended', 'create'),
      stepLine('sandbox step started', 'clone'),
      stepLine('sandbox step ended', 'clone'),
      stepLine('sandbox step started', 'setup', { commands: ['true'] }),
      stepLine('sandbox step ended', 'setup', { commands: ['true'] }),
      stepLine('sandbox step started', 'setup', { commands: ['echo ready'] }),
      stepLine('sandbox step ended', 'setup', { commands: ['echo ready'] }),
      stepLine('sandbox step started', 'bind'),
      stepLine('sandbox step ended', 'bind')
    ])
    expect(recorded.events).toStrictEqual([
      { step: 'create' },
      { step: 'clone' },
      { step: 'setup', commands: ['true'] },
      { step: 'setup', commands: ['echo ready'] },
      { step: 'bind' },
      { step: 'done' }
    ])
  })

  it('logs the error and the duration of a failed step, and tells the worker plugins the setup is over', async () => {
    const url = await createMigratedDatabase()
    const recorded = recordSetupEvents()
    await using agent = await openWorkers(url, [{ text: 'Done.' }], {
      originUrl: origin.url,
      setup: ['exit 3'],
      plugins: [recorded.plugin]
    })

    const worker = await agent.workers.startWorker({
      starter: TEST_STARTER,
      repository: REPOSITORY,
      task: 'Say done.'
    })
    await worker.firstTurn

    expect(setupStepLines(worker.threadId)).toStrictEqual([
      stepLine('sandbox step started', 'create'),
      stepLine('sandbox step ended', 'create'),
      stepLine('sandbox step started', 'clone'),
      stepLine('sandbox step ended', 'clone'),
      stepLine('sandbox step started', 'setup', { commands: ['exit 3'] }),
      stepLine('sandbox step failed', 'setup', {
        commands: ['exit 3'],
        failed: true
      })
    ])
    expect(recorded.events.at(-1)).toStrictEqual({ step: 'done' })
  })
})
