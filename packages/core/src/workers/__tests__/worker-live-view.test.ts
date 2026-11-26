import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createMigratedDatabase } from '#/testing/test-database.ts'
import { TEST_STARTER } from '#/testing/test-doubles.ts'
import type { WorkerView } from '#/workers/worker-view.ts'
import {
  callTool,
  createOrigin,
  holdTwoTurns,
  REPOSITORY,
  routedResponses,
  SANDBOX_SECRETS,
  TICKET_START,
  toolResultsOf
} from './worker-fixtures.ts'
import {
  askOrchestrator,
  closeWorkerTestbed,
  openWorkers,
  openWorkerTestbed,
  outcomeOf,
  testbedHostFree,
  type OpenedWorkers
} from './worker-testbed.ts'

const SETUP_HOLD_MS = 300

const TWO_NAMES = ['Alpha', 'Beta']

const PULL_REQUEST = 'https://example.com/acme/app/pull/7'

const DAYS_PAST_THE_WINDOW = 8

function viewOn(views: readonly WorkerView[], threadId: string) {
  const view = views.find((worker) => {
    return worker.threadId === threadId
  })

  if (view === undefined) {
    throw new Error(`The view shows no worker on ${threadId}.`)
  }

  return view
}

async function viewOf(agent: OpenedWorkers, threadId: string) {
  return viewOn(await agent.inspectWorkers(), threadId)
}

async function sharedViewOf(agent: OpenedWorkers, threadId: string) {
  return viewOn(await agent.viewWorkers(), threadId)
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

  it('shows a worker in setup in the view that list_workers reads, with no sandbox in it', async () => {
    const url = await createMigratedDatabase()
    await using held = await holdSetup()
    await using agent = await openWorkers(url, [{ text: 'Done.' }], {
      originUrl: origin.url,
      setup: [held.command]
    })
    const worker = await agent.workers.startWorker({
      starter: TEST_STARTER,
      repository: REPOSITORY,
      task: 'Say done.'
    })

    try {
      await expect
        .poll(async () => {
          const view = await sharedViewOf(agent, worker.threadId)

          return view.phase
        })
        .toBe('setup')
      const view = await sharedViewOf(agent, worker.threadId)

      expect(view.sandbox).toBeUndefined()
    } finally {
      await held.release()
    }

    await worker.firstTurn
  })

  it('shows a worker that waits for a free turn as queued in the view that list_workers reads', async () => {
    const url = await createMigratedDatabase()
    const released = Promise.withResolvers<null>()
    await using agent = await openWorkers(
      url,
      [...holdTwoTurns(released.promise), { text: 'Done.' }],
      { workerNames: TWO_NAMES, maxRunningTurns: 1 }
    )
    const startTask = (task: string) => {
      return agent.workers.startWorker({
        starter: TEST_STARTER,
        repository: REPOSITORY,
        task
      })
    }

    const running = await startTask('Task 0')
    await expect
      .poll(async () => {
        const view = await sharedViewOf(agent, running.threadId)

        return view.phase
      })
      .toBe('model')
    const queued = await startTask('Task 1')
    await expect
      .poll(async () => {
        const view = await sharedViewOf(agent, queued.threadId)

        return view.phase
      })
      .toBe('queued')
    released.resolve(null)
    await Promise.all([running.firstTurn, queued.firstTurn])
  })

  it('reads the whole diff of a worker in one read, with each secret it knows masked', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      routedResponses(
        [],
        [
          callTool('write_file', {
            path: 'README.md',
            content: `The repository.\ntoken ${SANDBOX_SECRETS.NPM_TOKEN}\n`
          }),
          callTool('write_file', { path: 'NOTES.md', content: 'new\n' }),
          { text: 'Done.' }
        ]
      ),
      { originUrl: origin.url }
    )
    const worker = await agent.workers.startWorker(TICKET_START)
    await worker.firstTurn

    const diff = await agent.readWorkerDiff(worker.threadId)

    expect(diff).toContain('+++ b/README.md')
    expect(diff).toContain('+++ b/NOTES.md')
    expect(diff).not.toContain(SANDBOX_SECRETS.NPM_TOKEN)
    expect(await agent.readWorkerDiff('no-such-thread')).toBeNull()
  })

  it('shows the pull request and the budget of a worker in the live view and in the line of list_workers', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      routedResponses(
        [callTool('list_workers'), { text: 'Alpha has a pull request.' }],
        [{ text: 'On it.' }]
      )
    )
    const worker = await agent.workers.startWorker(TICKET_START)
    await worker.firstTurn
    await agent.workers.updateWorker({
      threadId: worker.threadId,
      metadata: { pullRequest: PULL_REQUEST }
    })

    const shared = await sharedViewOf(agent, worker.threadId)
    const live = await viewOf(agent, worker.threadId)
    const answer = await askOrchestrator(agent)

    expect(shared).toMatchObject({
      name: 'Alpha',
      topic: 'TASK-7',
      phase: 'idle',
      budgetUsd: 100,
      pullRequest: PULL_REQUEST,
      waits: []
    })
    expect(live).toMatchObject(shared)
    expect(toolResultsOf(answer.events).join('\n')).toContain(
      `Alpha on TASK-7 in ${REPOSITORY}: sleeps, spent $0.00 of $100.00, pull request ${PULL_REQUEST}`
    )
  })

  it('shows the tasks that finished in the last seven days with their outcome and their cost, in the live view and in the line of list_workers', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      routedResponses(
        [callTool('list_workers'), { text: 'The task merged.' }],
        [{ text: 'On it.' }]
      ),
      { workerNames: TWO_NAMES }
    )
    const recent = await agent.workers.startWorker(TICKET_START)
    await recent.firstTurn
    const older = await agent.workers.startWorker({
      ...TICKET_START,
      subject: 'TASK-8',
      inputId: 'TASK-8'
    })
    await older.firstTurn
    await agent.workers.finishWorker({
      threadId: recent.threadId,
      report: 'Merged.',
      outcome: { value: 'flawed' }
    })
    await agent.workers.finishWorker({
      threadId: older.threadId,
      report: 'Stopped.',
      outcome: { value: 'blocked', cause: 'It used its budget.' }
    })
    await agent.workers.updateWorker({
      threadId: older.threadId,
      metadata: {
        outcome: {
          value: 'blocked',
          costUsd: 0,
          changedAt: Temporal.Now.zonedDateTimeISO('UTC').subtract({
            days: DAYS_PAST_THE_WINDOW
          }).epochMilliseconds
        }
      }
    })

    const outcome = await outcomeOf(agent, recent.threadId)

    const views = await agent.viewWorkers()
    const live = await agent.inspectWorkers()
    const answer = await askOrchestrator(agent)

    expect(views).toMatchObject([
      {
        threadId: recent.threadId,
        name: recent.name,
        phase: 'finished',
        outcome: { value: 'flawed' },
        spentUsd: outcome?.costUsd
      }
    ])
    expect(live).toStrictEqual(views)
    expect(toolResultsOf(answer.events).join('\n')).toContain(
      `${recent.name} on TASK-7 in ${REPOSITORY}: finished flawed, spent $0.00`
    )
  })
})
