import { setTimeout } from 'node:timers/promises'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi
} from 'vitest'
import { createMigratedDatabase } from '#/testing/test-database.ts'
import { TEST_STARTER } from '#/testing/test-doubles.ts'
import type { WorkerChange } from '#/workers/live-workers.ts'
import {
  bash,
  CHECK_THE_WORK,
  COMMIT_AND_SHOW_WHO,
  createOrigin,
  describeChange,
  finishTask,
  FOUR_NAMES,
  holdTwoTurns,
  HOST_COMMITTER,
  loggedLines,
  REPOSITORY,
  RESTORED_WORK,
  SANDBOX_SECRETS,
  SECOND_REPOSITORY,
  SHORT_IDLE_MS,
  TICKET_START,
  toolResults,
  WORK_ON_A_BRANCH
} from './worker-fixtures.ts'
import {
  closeWorkerTestbed,
  liveSandboxKeys,
  openWorkers,
  openWorkerTestbed,
  runWorkerThenCrash,
  runWorkerThenStop,
  runWorkerUntilAPersonEndsIt,
  tellToStop,
  testbedHostFree,
  waitForArchive,
  workOnABranch
} from './worker-testbed.ts'

type ExpectOneQueuedTurnParams = {
  maxRunningTurns: number
  liveStatuses: string[]
}

async function expectOneQueuedTurn({
  maxRunningTurns,
  liveStatuses
}: ExpectOneQueuedTurnParams) {
  const url = await createMigratedDatabase()
  const released = Promise.withResolvers<null>()
  await using agent = await openWorkers(
    url,
    [...holdTwoTurns(released.promise), { text: 'Done.' }],
    { workerNames: FOUR_NAMES, maxRunningTurns }
  )

  const workers = await Promise.all(
    liveStatuses.map((_status, index) => {
      return agent.workers.startWorker({
        repository: REPOSITORY,
        starter: TEST_STARTER,
        task: `Task ${index}`
      })
    })
  )
  await expect
    .poll(async () => {
      const listed = await agent.workers.listWorkers()

      return listed
        .map(({ liveStatus }) => {
          return liveStatus
        })
        .toSorted()
    })
    .toStrictEqual(liveStatuses)
  released.resolve(null)
  await Promise.all(
    workers.map(({ firstTurn }) => {
      return firstTurn
    })
  )

  await expect(agent.workers.listWorkers()).resolves.toMatchObject(
    liveStatuses.map(() => {
      return { liveStatus: 'idle', usage: { turns: 1 } }
    })
  )
}

async function expectQueuedThenRunning() {
  const url = await createMigratedDatabase()
  const released = Promise.withResolvers<null>()
  await using agent = await openWorkers(
    url,
    [...holdTwoTurns(released.promise), { text: 'Done.' }],
    { workerNames: FOUR_NAMES, maxRunningTurns: 1 }
  )
  const changes: WorkerChange[] = []
  await using tracking = await agent.workers.trackLiveWorkers((change) => {
    changes.push(change)
  })
  const startTask = (task: string) => {
    return agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task
    })
  }
  const statusesOf = (threadId: string) => {
    return changes
      .filter(({ worker }) => {
        return worker.threadId === threadId
      })
      .map(describeChange)
      .filter((status, index, all) => {
        return status !== all[index - 1]
      })
      .join(' ')
  }

  const running = await startTask('Task 0')
  await expect
    .poll(() => {
      return statusesOf(running.threadId)
    })
    .toBe('running')
  const queued = await startTask('Task 1')
  await expect
    .poll(() => {
      return tracking.liveWorkers().find(({ threadId }) => {
        return threadId === queued.threadId
      })?.liveStatus
    })
    .toBe('queued')
  released.resolve(null)
  await Promise.all([running.firstTurn, queued.firstTurn])

  await expect
    .poll(() => {
      return statusesOf(queued.threadId)
    })
    .toMatch(/queued running idle$/u)
}

describe('the worker lifecycle', () => {
  beforeAll(async () => {
    await openWorkerTestbed({ hasEntrySkill: true })
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it.each([
    { maxRunningTurns: 1, liveStatuses: ['queued', 'running'] },
    { maxRunningTurns: 2, liveStatuses: ['queued', 'running', 'running'] }
  ])(
    'runs $maxRunningTurns turn(s) at once, and queues the next one until a slot frees',
    expectOneQueuedTurn
  )

  it(
    'tells a worker that waits for a turn slot as queued, then running once it gets the slot',
    expectQueuedThenRunning
  )

  it('archives a finished worker, destroys its sandbox, and ends its turn', async () => {
    const url = await createMigratedDatabase()
    const report = 'Opened the pull request 12, merged by a person.'
    const callsAfterFinish: string[] = []
    await using agent = await openWorkers(url, [
      bash('git init'),
      { text: 'Ready for review.' },
      finishTask({ report }),
      ({ request }) => {
        callsAfterFinish.push(JSON.stringify(request.messages))

        return { text: 'Still here.' }
      }
    ])

    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Fix the login.',
      subject: 'TASK-3'
    })
    await worker.firstTurn
    await tellToStop(agent, worker.threadId)

    await waitForArchive(agent, worker.threadId)
    await expect(agent.workers.listWorkers()).resolves.toStrictEqual([])
    await expect(liveSandboxKeys()).resolves.not.toContain(
      agent.sandboxKey(worker.threadId)
    )
    expect(callsAfterFinish).toStrictEqual([])
    expect(
      loggedLines.filter((line) => {
        return line.includes(report)
      })
    ).toHaveLength(1)
  })

  it('closes a worker with no report when its lines in the thread said it all', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(url, [
      { text: 'Done, the chart is in the thread.' },
      finishTask({ report: undefined })
    ])

    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Draw a chart.',
      subject: 'chart'
    })
    await worker.firstTurn
    await tellToStop(agent, worker.threadId)
    await waitForArchive(agent, worker.threadId)
    const entry = await agent.host.sessions.get({ threadId: worker.threadId })

    expect(entry).toMatchObject({ archived: true })
    expect(entry?.metadata).not.toHaveProperty('report')
  })

  it('refuses a second worker on a ticket or a branch with a live worker, also after a restart', async () => {
    const url = await createMigratedDatabase()
    await runWorkerThenStop(url, [{ text: 'On it.' }], {
      repository: REPOSITORY,
      task: 'Fix the login.',
      subject: 'TASK-4',
      branch: 'task-4-fix-the-login'
    })

    await using restarted = await openWorkers(url, [])

    await expect(
      restarted.workers.startWorker({
        repository: REPOSITORY,
        starter: TEST_STARTER,
        task: 'Fix it again.',
        subject: 'TASK-4'
      })
    ).rejects.toThrow('Alpha already works on TASK-4')
    await expect(
      restarted.workers.startWorker({
        repository: REPOSITORY,
        starter: TEST_STARTER,
        task: 'Push on the branch.',
        branch: 'task-4-fix-the-login'
      })
    ).rejects.toThrow('Alpha already works on TASK-4')
    await expect(restarted.workers.listWorkers()).resolves.toHaveLength(1)
  })

  it('starts a new worker on the ticket of a finished worker', async () => {
    const url = await createMigratedDatabase()
    await runWorkerUntilAPersonEndsIt(url, {
      repository: REPOSITORY,
      task: 'Fix the login.',
      subject: 'TASK-5'
    })

    await using restarted = await openWorkers(url, [{ text: 'On it.' }])
    const worker = await restarted.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Fix the logout.',
      subject: 'TASK-5'
    })
    await worker.firstTurn

    expect(worker.name).toBe('Alpha')
  })

  it('destroys the sandbox of a worker idle past its limit', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      [bash('git init'), { text: 'Done.' }],
      { idleSandboxMs: 50 }
    )

    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Init the repo.'
    })
    await worker.firstTurn

    await expect
      .poll(liveSandboxKeys)
      .not.toContain(agent.sandboxKey(worker.threadId))
    await expect(agent.workers.listWorkers()).resolves.toMatchObject([
      { name: 'Alpha', liveStatus: 'idle' }
    ])
  })

  it('sweeps the sandboxes at start after a host crash: an orphan and an idle one go, a recent one and the library stay', async () => {
    const url = await createMigratedDatabase()
    await testbedHostFree().provider.create({ id: 'orphan-sandbox' })
    const { threadId } = await runWorkerThenCrash(
      url,
      [bash('git init'), { text: 'Done.' }],
      { repository: REPOSITORY, task: 'Init the repo.' }
    )

    await using recent = await openWorkers(url, [])
    const keptKeys = await liveSandboxKeys()

    expect(keptKeys).not.toContain('orphan-sandbox')
    expect(keptKeys).toContain(recent.sandboxKey(threadId))
    await recent.library.pullOnce()

    await using late = await openWorkers(url, [], { idleSandboxMs: 0 })
    const lateKeys = await liveSandboxKeys()

    expect(lateKeys).not.toContain(late.sandboxKey(threadId))
    expect(lateKeys).toContain(late.library.key)
  })

  it('keeps at start after a host crash the sandbox of a turn that resumes, past the idle limit', async () => {
    const url = await createMigratedDatabase()
    const { threadId } = await runWorkerThenCrash(
      url,
      [
        {
          toolCalls: [
            {
              name: 'write_file',
              input: {
                path: 'kept.md',
                content: 'kept for the resumed turn\n'
              }
            }
          ]
        },
        { text: 'Written.' }
      ],
      { repository: REPOSITORY, task: 'Write a file.' }
    )
    await using submitter = await openWorkers(url, [])
    await submitter.host.submit({
      user: TEST_STARTER,
      harness: submitter.harness,
      threadId,
      input: { op: 'prompt', message: 'Read the file.' },
      inputId: 'read-the-file'
    })
    await submitter.host.close()
    vi.useFakeTimers({ toFake: ['Date', 'Temporal'] })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    vi.setSystemTime(
      Temporal.Now.instant().add({ milliseconds: SHORT_IDLE_MS * 2 })
    )

    await using restarted = await openWorkers(
      url,
      [
        { toolCalls: [{ name: 'read_file', input: { path: 'kept.md' } }] },
        { text: 'Read.' }
      ],
      { idleSandboxMs: SHORT_IDLE_MS }
    )

    await expect
      .poll(async () => {
        const view = await restarted.host.observe(restarted.harness, {
          threadId
        })

        return toolResults(await view.transcript())
      })
      .toContain('kept for the resumed turn')
  })

  it('runs at start the turn that waits in the store with no host', async () => {
    const url = await createMigratedDatabase()
    const { threadId } = await runWorkerThenStop(url, [{ text: 'On it.' }], {
      repository: REPOSITORY,
      task: 'Fix the login.'
    })
    await using submitter = await openWorkers(url, [])
    await submitter.host.submit({
      user: TEST_STARTER,
      harness: submitter.harness,
      threadId,
      input: { op: 'prompt', message: 'Go on.' },
      inputId: 'go-on'
    })
    await submitter.host.close()

    await using restarted = await openWorkers(url, [{ text: 'Done.' }])

    await expect
      .poll(() => {
        return restarted.workers.listWorkers()
      })
      .toMatchObject([{ liveStatus: 'idle', usage: { turns: 2 } }])
  })
})

describe('a worker of a task with an input id', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('starts one worker for one input id, also after a restart', async () => {
    const url = await createMigratedDatabase()
    const started = await runWorkerThenStop(
      url,
      [{ text: 'On it.' }],
      TICKET_START
    )

    await using restarted = await openWorkers(url, [])
    const again = await restarted.workers.startWorker(TICKET_START)
    await again.firstTurn
    const twice = await restarted.workers.startWorker(TICKET_START)
    await twice.firstTurn

    expect([again.threadId, twice.threadId]).toStrictEqual([
      started.threadId,
      started.threadId
    ])
    await expect(restarted.workers.listWorkers()).resolves.toMatchObject([
      { name: 'Alpha', subject: 'TASK-7', usage: { turns: 1 } }
    ])
  })

  it('starts no second worker for the input id of a finished worker', async () => {
    const url = await createMigratedDatabase()
    const finished = await runWorkerUntilAPersonEndsIt(url, TICKET_START)

    await using restarted = await openWorkers(url, [])
    const again = await restarted.workers.startWorker(TICKET_START)

    expect(again).toMatchObject({ threadId: finished.threadId, isNew: false })
    await expect(restarted.workers.listWorkers()).resolves.toStrictEqual([])
  })

  it('refuses a repository that no sandbox runs, and opens no worker', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(url, [])

    await expect(
      agent.workers.startWorker({ ...TICKET_START, repository: 'acme/unknown' })
    ).rejects.toThrow('No sandbox runs the repository acme/unknown.')
    await expect(agent.workers.listWorkers()).resolves.toHaveLength(0)
  })
})

describe('a sleeping worker', () => {
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

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('works in the clone of the repository of its task', async () => {
    const url = await createMigratedDatabase()
    const tooling = await createOrigin('The tooling repository.\n')
    onTestFinished(async () => {
      await tooling.destroy()
    })
    await using agent = await openWorkers(
      url,
      [
        { toolCalls: [{ name: 'read_file', input: { path: 'README.md' } }] },
        { text: 'Read.' }
      ],
      { originUrl: origin.url, secondOriginUrl: tooling.url }
    )

    const worker = await agent.workers.startWorker({
      starter: TEST_STARTER,
      repository: SECOND_REPOSITORY,
      task: 'Read the readme.'
    })
    await worker.firstTurn
    const view = await agent.host.observe(agent.harness, {
      threadId: worker.threadId
    })

    expect(toolResults(await view.transcript())).toContain(
      'The tooling repository.'
    )
  })

  it('wakes past its sandbox lifetime with its context, its branch and its uncommitted changes', async () => {
    const url = await createMigratedDatabase()
    const modelRequests: string[] = []
    await using agent = await openWorkers(
      url,
      [
        { text: 'On it.' },
        bash(WORK_ON_A_BRANCH),
        { text: 'Changed.' },
        ({ request }) => {
          modelRequests.push(JSON.stringify(request))

          return bash(CHECK_THE_WORK)
        },
        { text: 'All there.' }
      ],
      { originUrl: origin.url, idleSandboxMs: 50 }
    )
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Work on a branch.'
    })
    await worker.firstTurn
    await using session = await agent.host.open(agent.harness, {
      user: TEST_STARTER,
      threadId: worker.threadId
    })
    await session.setPluginSetting({ key: 'mode', value: 'bypass' })
    await session.send('Change the files.')
    await expect
      .poll(liveSandboxKeys)
      .not.toContain(agent.sandboxKey(worker.threadId))

    await session.send('Check the work.')
    const results = toolResults(await session.transcript())

    expect(modelRequests.join('\n')).toContain('Changed.')
    expect(modelRequests.join('\n')).toContain(
      'The branch of this task: task-9-wake-up.'
    )
    expect(results).toContain(RESTORED_WORK)
  })

  it('keeps its sandbox when its idle limit passes while its next turn starts', async () => {
    const url = await createMigratedDatabase()
    const turnStarted = Promise.withResolvers<null>()
    await using agent = await openWorkers(
      url,
      [{ text: 'On it.' }, bash(WORK_ON_A_BRANCH), { text: 'Changed.' }],
      {
        originUrl: origin.url,
        idleSandboxMs: SHORT_IDLE_MS,
        holdSecondTurnStart: turnStarted.promise
      }
    )
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Work on a branch.'
    })
    await worker.firstTurn
    await using session = await agent.host.open(agent.harness, {
      user: TEST_STARTER,
      threadId: worker.threadId
    })
    await session.setPluginSetting({ key: 'mode', value: 'bypass' })

    const nextTurn = session.send('Change the files.')
    await setTimeout(2 * SHORT_IDLE_MS)
    turnStarted.resolve(null)
    await nextTurn

    expect(toolResults(await session.transcript())).not.toContain('ENOENT')
  })

  it('wakes after a host restart in a fresh sandbox, on a dev that moved on', async () => {
    const url = await createMigratedDatabase()
    const { threadId } = await workOnABranch(url, origin.url)
    await origin.advance()

    await using restarted = await openWorkers(
      url,
      [bash(CHECK_THE_WORK), { text: 'All there.' }],
      { originUrl: origin.url, idleSandboxMs: 0 }
    )
    await expect(liveSandboxKeys()).resolves.not.toContain(
      restarted.sandboxKey(threadId)
    )
    await using session = await restarted.host.open(restarted.harness, {
      user: TEST_STARTER,
      threadId
    })
    await session.setPluginSetting({ key: 'mode', value: 'bypass' })
    await session.send('Check the work.')
    const results = toolResults(await session.transcript())

    expect(results).toContain(RESTORED_WORK)
  })

  it('commits as the host git identity in a fresh sandbox', async () => {
    const url = await createMigratedDatabase()
    const { threadId } = await workOnABranch(url, origin.url)

    await using restarted = await openWorkers(
      url,
      [bash(COMMIT_AND_SHOW_WHO), { text: 'Done.' }],
      { originUrl: origin.url, idleSandboxMs: 0 }
    )
    await expect(liveSandboxKeys()).resolves.not.toContain(
      restarted.sandboxKey(threadId)
    )
    await using session = await restarted.host.open(restarted.harness, {
      user: TEST_STARTER,
      threadId
    })
    await session.setPluginSetting({ key: 'mode', value: 'bypass' })
    await session.send('Commit.')

    expect(toolResults(await session.transcript())).toContain(HOST_COMMITTER)
  })

  it('deletes the saved changes of a worker that finishes', async () => {
    const url = await createMigratedDatabase()
    const { threadId } = await workOnABranch(url, origin.url)

    await using restarted = await openWorkers(url, [finishTask()], {
      originUrl: origin.url
    })
    await expect(restarted.changes.load(threadId)).resolves.toBeDefined()
    await tellToStop(restarted, threadId)
    await waitForArchive(restarted, threadId)

    await expect(restarted.changes.load(threadId)).resolves.toBeUndefined()
  })

  it('keeps its last save when its changes hold a sandbox secret', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      [
        { text: 'On it.' },
        bash(`echo ${SANDBOX_SECRETS.NPM_TOKEN} > leaked.md`),
        { text: 'Written.' }
      ],
      { originUrl: origin.url }
    )
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Write a file.'
    })
    await worker.firstTurn
    const cleanSave = await agent.changes.load(worker.threadId)
    await using session = await agent.host.open(agent.harness, {
      user: TEST_STARTER,
      threadId: worker.threadId
    })
    await session.setPluginSetting({ key: 'mode', value: 'bypass' })
    await session.send('Write the file.')

    await expect(agent.changes.load(worker.threadId)).resolves.toStrictEqual(
      cleanSave
    )
    expect(loggedLines.join('\n')).toContain('worker changes hold a secret')
    expect(loggedLines.join('\n')).not.toContain(SANDBOX_SECRETS.NPM_TOKEN)
  })
})
