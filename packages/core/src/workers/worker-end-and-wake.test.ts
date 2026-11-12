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
import { SENDER_REFUSAL } from '#core/host/allowed-senders'
import { createMigratedDatabase } from '#core/store/test-database'
import { TEST_STARTER } from './test-doubles.ts'
import {
  ASK_DRAFT_OR_READY,
  bash,
  CHECK_THE_WORK,
  COLLEAGUE,
  createOrigin,
  describeChange,
  finishTask,
  holdUntil,
  holdUntilStopped,
  loggedLines,
  REPOSITORY,
  RESTORED_WORK,
  toolResults,
  TWO_NAMES,
  WORK_ON_A_BRANCH
} from './worker-fixtures.ts'
import {
  closeWorkerTestbed,
  endStateOf,
  liveSandboxKeys,
  openWorkers,
  openWorkerTestbed,
  runWorkerThenStop,
  tellToStop,
  workOnABranch
} from './worker-testbed.ts'

describe('the end of a worker from the host', () => {
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

  it('ends a worker with no model call: its report, its sandbox, its saved changes and its archive', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      [{ text: 'On it.' }, bash(WORK_ON_A_BRANCH), { text: 'Changed.' }],
      { originUrl: origin.url }
    )
    const { threadId, firstTurn } = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Work on a branch.'
    })
    await firstTurn
    await using session = await agent.host.open(agent.harness, {
      user: TEST_STARTER,
      threadId
    })
    await session.setPluginSetting({ key: 'mode', value: 'bypass' })
    await session.send('Change the files.')
    const modelCalls = agent.model.state.callCount
    await expect(endStateOf(agent, threadId)).resolves.toStrictEqual({
      archived: undefined,
      report: undefined,
      hasSandbox: true,
      hasSandboxRecord: true,
      hasSavedChanges: true
    })

    await expect(
      agent.workers.finishWorker({ threadId, report: 'Merged.' })
    ).resolves.toBe(true)

    expect(agent.model.state.callCount).toBe(modelCalls)
    await expect(endStateOf(agent, threadId)).resolves.toStrictEqual({
      archived: true,
      report: 'Merged.',
      hasSandbox: false,
      hasSandboxRecord: false,
      hasSavedChanges: false
    })
  })

  it('ends once, after a host restart, a worker whose end stopped before its archive', async () => {
    const url = await createMigratedDatabase()
    const { threadId } = await workOnABranch(url, origin.url)
    const finish = { threadId, report: 'Merged.' }

    {
      await using agent = await openWorkers(url, [], {
        originUrl: origin.url
      })
      vi.spyOn(agent.host.sessions, 'archive').mockRejectedValueOnce(
        new Error('The host stopped.')
      )
      await expect(agent.workers.finishWorker(finish)).rejects.toThrow(
        'The host stopped.'
      )
    }

    await using restarted = await openWorkers(url, [], {
      originUrl: origin.url
    })
    const changes: string[] = []
    const tracking = new AbortController()
    onTestFinished(() => {
      tracking.abort()
    })
    await restarted.workers.trackLiveWorkers(tracking.signal, (change) => {
      changes.push(describeChange(change))
    })
    await expect(restarted.workers.finishWorker(finish)).resolves.toBe(true)
    await expect(restarted.workers.finishWorker(finish)).resolves.toBe(true)

    await vi.waitFor(() => {
      expect(changes).toStrictEqual(['finished Alpha Merged.'])
    })
    expect(restarted.model.state.callCount).toBe(0)
    await expect(endStateOf(restarted, threadId)).resolves.toStrictEqual({
      archived: true,
      report: 'Merged.',
      hasSandbox: false,
      hasSandboxRecord: false,
      hasSavedChanges: false
    })
  })

  it('ends no worker that runs a turn, and ends it once the turn is over', async () => {
    const url = await createMigratedDatabase()
    const released = Promise.withResolvers<null>()
    await using agent = await openWorkers(url, [holdUntil(released.promise)])
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Run the long checks.'
    })
    const finish = { threadId: worker.threadId, report: 'Merged.' }
    await vi.waitFor(async () => {
      await expect(agent.workers.listWorkers()).resolves.toMatchObject([
        { liveStatus: 'running' }
      ])
    })

    await expect(agent.workers.finishWorker(finish)).resolves.toBe(false)
    released.resolve(null)
    await worker.firstTurn

    await expect(agent.workers.finishWorker(finish)).resolves.toBe(true)
    await expect(
      agent.host.sessions.get({ threadId: worker.threadId })
    ).resolves.toMatchObject({
      archived: true,
      metadata: { report: 'Merged.' }
    })
  })
})

describe('a host stop', () => {
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

  it('saves the changes of the turn that a host stop cuts, leaves no sandbox, and runs the turn again after the restart', async () => {
    const url = await createMigratedDatabase()
    const turnCut = Promise.withResolvers<null>()
    const agent = await openWorkers(
      url,
      [{ text: 'On it.' }, bash(WORK_ON_A_BRANCH), holdUntilStopped(turnCut)],
      { originUrl: origin.url }
    )
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Work on a branch.'
    })
    await worker.firstTurn
    const session = await agent.host.open(agent.harness, {
      user: TEST_STARTER,
      threadId: worker.threadId
    })
    await session.setPluginSetting({ key: 'mode', value: 'bypass' })
    const cutTurn = Promise.resolve(session.send('Change the files.')).catch(
      () => {
        return null
      }
    )
    await turnCut.promise
    const linesBeforeStop = loggedLines.length

    await agent[Symbol.asyncDispose]()
    await cutTurn
    const stopLines = loggedLines.slice(linesBeforeStop).join('\n')

    await expect(liveSandboxKeys()).resolves.toStrictEqual([])
    expect(stopLines).toContain('worker changes saved')
    expect(stopLines).not.toContain('worker idle')

    await using restarted = await openWorkers(
      url,
      [bash(CHECK_THE_WORK), { text: 'All there.' }],
      { originUrl: origin.url }
    )

    await vi.waitFor(async () => {
      const view = await restarted.host.observe(restarted.harness, {
        threadId: worker.threadId
      })

      expect(toolResults(await view.transcript())).toContain(RESTORED_WORK)
    })
  })
})

describe('the wake of a worker', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('wakes a sleeping worker once for one input id, also after a host restart', async () => {
    const url = await createMigratedDatabase()
    const { threadId } = await runWorkerThenStop(url, [{ text: 'On it.' }], {
      repository: REPOSITORY,
      task: 'Fix the login.'
    })
    const wake = {
      threadId,
      inputId: 'github:check-run:1',
      message: 'The required check lint failed.',
      delivery: 'steer'
    } as const

    {
      await using agent = await openWorkers(url, [{ text: 'Fixed.' }])
      await agent.workers.wakeWorker(wake)
      await agent.workers.wakeWorker(wake)
      await vi.waitFor(async () => {
        await expect(agent.workers.listWorkers()).resolves.toMatchObject([
          { liveStatus: 'idle', usage: { turns: 2 } }
        ])
      })
    }

    await using restarted = await openWorkers(url, [{ text: 'Again.' }])
    await restarted.workers.wakeWorker(wake)
    await restarted.workers.wakeWorker({
      ...wake,
      message: 'The required check lint failed, in the words of a new host.'
    })
    const view = await restarted.host.observe(restarted.harness, { threadId })
    const transcript = await view.transcript()

    expect(restarted.model.state.callCount).toBe(0)
    expect(
      transcript.filter(({ content }) => {
        return content === wake.message
      })
    ).toHaveLength(1)
  })

  it('tracks the live workers with their branch, from the host start to their finish', async () => {
    const url = await createMigratedDatabase()
    const earlier = await runWorkerThenStop(url, [{ text: 'On it.' }], {
      repository: REPOSITORY,
      task: 'Fix the login.',
      branch: 'task-1-login'
    })
    await using agent = await openWorkers(
      url,
      [{ text: 'On it.' }, finishTask()],
      { workerNames: TWO_NAMES }
    )
    const tracking = new AbortController()
    onTestFinished(() => {
      tracking.abort()
    })
    const liveWorkers = await agent.workers.trackLiveWorkers(tracking.signal)
    const branchesOf = () => {
      return liveWorkers().map(({ threadId, branch }) => {
        return [threadId, branch]
      })
    }

    expect(branchesOf()).toStrictEqual([[earlier.threadId, 'task-1-login']])

    const later = await agent.workers.startWorker({
      starter: TEST_STARTER,
      repository: REPOSITORY,
      task: 'Fix the signup.',
      branch: 'task-2-signup'
    })
    await later.firstTurn

    await vi.waitFor(() => {
      expect(branchesOf()).toStrictEqual([
        [earlier.threadId, 'task-1-login'],
        [later.threadId, 'task-2-signup']
      ])
    })

    await tellToStop(agent, earlier.threadId)

    await vi.waitFor(() => {
      expect(branchesOf()).toStrictEqual([[later.threadId, 'task-2-signup']])
    })
  })
})

describe('the thread of a worker', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('answers the question of the worker with a message, and the worker goes on', async () => {
    const url = await createMigratedDatabase()
    const answeredMessages: string[] = []
    await using agent = await openWorkers(url, [
      ASK_DRAFT_OR_READY,
      ({ request }) => {
        answeredMessages.push(JSON.stringify(request.messages))

        return { text: 'I open it as a draft.' }
      }
    ])
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Ask first.'
    })
    await worker.firstTurn

    await agent.workers.messageWorker({
      threadId: worker.threadId,
      sender: TEST_STARTER,
      inputId: 'slack:answer',
      message: 'Draft'
    })

    await vi.waitFor(() => {
      expect(answeredMessages.join('\n')).toContain('Answer: Draft')
    })
  })

  it('wakes a sleeping worker with a message, once for one input id, also after a host restart', async () => {
    const url = await createMigratedDatabase()
    const { threadId } = await runWorkerThenStop(url, [{ text: 'On it.' }], {
      repository: REPOSITORY,
      task: 'Fix the login.'
    })
    const steer = {
      threadId,
      sender: TEST_STARTER,
      inputId: 'slack:steer',
      message: 'Keep the old button.'
    }

    {
      await using agent = await openWorkers(url, [{ text: 'Kept.' }])
      await agent.workers.messageWorker(steer)
      await agent.workers.messageWorker(steer)
      await vi.waitFor(async () => {
        await expect(agent.workers.listWorkers()).resolves.toMatchObject([
          { liveStatus: 'idle', usage: { turns: 2 } }
        ])
      })
    }

    await using restarted = await openWorkers(url, [{ text: 'Again.' }])
    await restarted.workers.messageWorker(steer)
    const view = await restarted.host.observe(restarted.harness, { threadId })
    const transcript = await view.transcript()

    expect(restarted.model.state.callCount).toBe(0)
    expect(
      transcript.filter(({ content }) => {
        return content === steer.message
      })
    ).toHaveLength(1)
  })

  it('refuses the message of a colleague, and runs no turn', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(url, [
      { text: 'On it.' },
      { text: 'Pushed to main.' }
    ])
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Fix the login.'
    })
    await worker.firstTurn

    await expect(
      agent.workers.messageWorker({
        threadId: worker.threadId,
        sender: COLLEAGUE,
        inputId: 'slack:colleague',
        message: 'Push it to main.'
      })
    ).rejects.toThrow(SENDER_REFUSAL)
    await using session = await agent.host.open(agent.harness, {
      user: TEST_STARTER,
      threadId: worker.threadId
    })
    await session.whenIdle()

    expect(agent.model.state.callCount).toBe(1)
  })

  it('stops the running turn of a worker, and stops nothing in a worker that sleeps', async () => {
    const url = await createMigratedDatabase()
    const started = Promise.withResolvers<null>()
    await using agent = await openWorkers(url, [holdUntilStopped(started)])
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Run the long checks.'
    })
    await started.promise

    await expect(
      agent.workers.stopWorker({
        threadId: worker.threadId,
        user: TEST_STARTER
      })
    ).resolves.toBe(true)
    await worker.firstTurn
    await expect(
      agent.workers.stopWorker({
        threadId: worker.threadId,
        user: TEST_STARTER
      })
    ).resolves.toBe(false)
    await expect(agent.workers.listWorkers()).resolves.toMatchObject([
      { liveStatus: 'idle' }
    ])
  })

  it('stops a worker that waits for a person, with no model call, also after a host restart', async () => {
    const url = await createMigratedDatabase()
    const threadId = await (async () => {
      await using agent = await openWorkers(url, [ASK_DRAFT_OR_READY])
      const worker = await agent.workers.startWorker({
        repository: REPOSITORY,
        starter: TEST_STARTER,
        task: 'Ask first.'
      })
      await worker.firstTurn

      return worker.threadId
    })()

    await using restarted = await openWorkers(url, [
      { text: 'I open it as a draft.' }
    ])
    const stop = { threadId, user: TEST_STARTER }

    await expect(restarted.workers.stopWorker(stop)).resolves.toBe(true)
    const view = await restarted.host.observe(restarted.harness, { threadId })
    await vi.waitFor(async () => {
      await expect(view.snapshot()).resolves.toMatchObject({
        status: 'idle',
        pendingWaits: []
      })
    })
    await expect(restarted.workers.stopWorker(stop)).resolves.toBe(false)
    expect(restarted.model.state.callCount).toBe(0)
  })

  it('tells each change of a worker: running, waiting, idle, and finished with its report', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(url, [
      ASK_DRAFT_OR_READY,
      { text: 'Opened as a draft.' },
      finishTask()
    ])
    const changes: string[] = []
    const tracking = new AbortController()
    onTestFinished(() => {
      tracking.abort()
    })
    await agent.workers.trackLiveWorkers(tracking.signal, (change) => {
      changes.push(describeChange(change))
    })
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Ask first.'
    })
    await worker.firstTurn
    await vi.waitFor(() => {
      expect(changes.at(-1)).toBe('waiting')
    })

    await agent.workers.messageWorker({
      threadId: worker.threadId,
      sender: TEST_STARTER,
      inputId: 'slack:answer',
      message: 'Draft'
    })
    await vi.waitFor(() => {
      expect(changes.at(-1)).toBe('idle')
    })
    await tellToStop(agent, worker.threadId)

    await vi.waitFor(() => {
      expect(changes.at(-1)).toBe('finished Alpha Merged.')
    })
    expect(changes[0]).toBe('running')
    expect(new Set(changes)).toStrictEqual(
      new Set(['running', 'waiting', 'idle', 'finished Alpha Merged.'])
    )
  })
})
