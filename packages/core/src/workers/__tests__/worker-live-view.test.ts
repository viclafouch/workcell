import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createMigratedDatabase } from '#/testing/test-database.ts'
import { TEST_STARTER } from '#/testing/test-doubles.ts'
import { createOrigin, REPOSITORY } from './worker-fixtures.ts'
import {
  closeWorkerTestbed,
  openWorkers,
  openWorkerTestbed,
  testbedHostFree,
  type OpenedWorkers
} from './worker-testbed.ts'

const SETUP_HOLD_MS = 300

async function viewOf(agent: OpenedWorkers, threadId: string) {
  const views = await agent.viewWorkers(await agent.workers.listWorkers())
  const view = views.find((worker) => {
    return worker.threadId === threadId
  })

  if (view === undefined) {
    throw new Error(`The live view shows no worker on ${threadId}.`)
  }

  return view
}

async function setupOf(agent: OpenedWorkers, threadId: string) {
  const { sandbox } = await viewOf(agent, threadId)

  return sandbox?.state === 'setup' ? sandbox : null
}

async function sandboxIdOf(agent: OpenedWorkers, threadId: string) {
  const listed = await testbedHostFree().list()

  return listed.find(({ key }) => {
    return key === agent.sandboxKey(threadId)
  })?.id
}

async function holdSetup() {
  const root = await mkdtemp(join(tmpdir(), 'held-setup-'))
  const gate = join(root, 'go')

  return {
    command: `while [ ! -f ${gate} ]; do sleep 0.05; done`,
    release: async () => {
      await writeFile(gate, '')
    },
    [Symbol.asyncDispose]: async () => {
      await rm(root, { recursive: true, force: true })
    }
  }
}

type HeldSetup = Awaited<ReturnType<typeof holdSetup>>

async function startWorkerInHeldSetup(agent: OpenedWorkers, held: HeldSetup) {
  const worker = await agent.workers.startWorker({
    starter: TEST_STARTER,
    repository: REPOSITORY,
    task: 'Say done.'
  })

  try {
    await expect
      .poll(async () => {
        const setup = await setupOf(agent, worker.threadId)

        return setup?.elapsedMs
      })
      .toBeGreaterThan(SETUP_HOLD_MS)

    return { worker, setupView: await viewOf(agent, worker.threadId) }
  } finally {
    await held.release()
  }
}

describe('the live view of a worker', () => {
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

  it('shows the sandbox of a worker in setup, with the running step and its elapsed time', async () => {
    const url = await createMigratedDatabase()
    await using held = await holdSetup()
    await using agent = await openWorkers(url, [{ text: 'Done.' }], {
      originUrl: origin.url,
      setup: [held.command]
    })

    const { worker, setupView } = await startWorkerInHeldSetup(agent, held)
    await worker.firstTurn

    expect(setupView.phase).toBe('setup')
    expect(setupView.sandbox).toMatchObject({
      state: 'setup',
      id: await sandboxIdOf(agent, worker.threadId),
      step: 'setup',
      commands: [held.command]
    })
  })

  it('keeps the time from the start of a worker to its first turn once the turn starts', async () => {
    const url = await createMigratedDatabase()
    await using held = await holdSetup()
    await using agent = await openWorkers(url, [{ text: 'Done.' }], {
      originUrl: origin.url,
      setup: [held.command]
    })

    const { worker, setupView } = await startWorkerInHeldSetup(agent, held)
    await worker.firstTurn
    const view = await viewOf(agent, worker.threadId)

    expect(setupView.startupMs).toBeUndefined()
    expect(view.sandbox?.state).toBe('ready')
    expect(view.startupMs).toBeGreaterThan(SETUP_HOLD_MS)
  })

  it('keeps the time from the start of a worker to its first turn through a host restart and the turns after it', async () => {
    const url = await createMigratedDatabase()
    const firstHost = await openWorkers(url, [{ text: 'On it.' }])
    const worker = await firstHost.workers.startWorker({
      starter: TEST_STARTER,
      repository: REPOSITORY,
      task: 'Say done.'
    })
    await worker.firstTurn
    const before = await viewOf(firstHost, worker.threadId)
    await firstHost.crash()

    await using restarted = await openWorkers(url, [{ text: 'Done again.' }])
    await restarted.workers.messageWorker({
      threadId: worker.threadId,
      sender: TEST_STARTER,
      inputId: `again:${worker.threadId}`,
      message: 'Say it again.'
    })
    await expect
      .poll(async () => {
        const view = await viewOf(restarted, worker.threadId)

        return view.spentUsd
      })
      .toBeGreaterThan(before.spentUsd)
    const after = await viewOf(restarted, worker.threadId)

    expect(before.startupMs).toBeGreaterThanOrEqual(0)
    expect(after.startupMs).toBe(before.startupMs)
  })
})
