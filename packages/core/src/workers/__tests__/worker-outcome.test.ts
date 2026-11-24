import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import { createMigratedDatabase } from '#/testing/test-database.ts'
import { TEST_STARTER } from '#/testing/test-doubles.ts'
import {
  bash,
  createOrigin,
  finishTask,
  REPOSITORY
} from './worker-fixtures.ts'
import {
  closeWorkerTestbed,
  endStateOf,
  openWorkers,
  openWorkerTestbed,
  outcomeOf,
  tellToStop,
  waitForArchive,
  workOnABranch
} from './worker-testbed.ts'

describe('the outcome of a task that a person stops', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it.each([
    { outcome: 'blocked', cause: 'The tests need a database it cannot reach.' },
    { outcome: 'manual', cause: 'A person finishes the change by hand.' }
  ] as const)(
    'ends as $outcome, with its cause and the spend of every turn up to its finish',
    async (end) => {
      const url = await createMigratedDatabase()
      await using agent = await openWorkers(url, [
        bash('git init --quiet'),
        { text: 'Stuck.' },
        finishTask({ report: undefined, ...end })
      ])
      const worker = await agent.workers.startWorker({
        repository: REPOSITORY,
        starter: TEST_STARTER,
        task: 'Fix the login.'
      })
      await worker.firstTurn
      const [view] = await agent.viewWorkers()

      await tellToStop(agent, worker.threadId)
      await waitForArchive(agent, worker.threadId)
      const outcome = await outcomeOf(agent, worker.threadId)

      expect(outcome).toMatchObject({ value: end.outcome, cause: end.cause })
      expect(outcome?.costUsd).toBeGreaterThan(Number(view?.spentUsd))
    }
  )
})

describe('the outcome of a task that the host ends', () => {
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

  it('ends a worker from the host with its outcome and what its task spent', async () => {
    const url = await createMigratedDatabase()
    const { threadId } = await workOnABranch(url, origin.url)
    await using agent = await openWorkers(url, [], { originUrl: origin.url })
    const [view] = await agent.viewWorkers()

    await agent.workers.finishWorker({
      threadId,
      report: 'Merged.',
      outcome: { value: 'flawed' }
    })

    expect(view?.spentUsd).toBeGreaterThan(0)
    await expect(outcomeOf(agent, threadId)).resolves.toMatchObject({
      value: 'flawed',
      costUsd: view?.spentUsd
    })
  })

  it('keeps the outcome of a merge when the host stops before its write, once the next poll ends the worker', async () => {
    const url = await createMigratedDatabase()
    const { threadId } = await workOnABranch(url, origin.url)
    const finish = {
      threadId,
      report: 'Merged.',
      outcome: { value: 'success' as const }
    }

    {
      await using agent = await openWorkers(url, [], {
        originUrl: origin.url
      })
      vi.spyOn(agent.host.sessions, 'update').mockRejectedValueOnce(
        new Error('The host stopped.')
      )
      await expect(agent.workers.finishWorker(finish)).rejects.toThrow(
        'The host stopped.'
      )
      await expect(outcomeOf(agent, threadId)).resolves.toBeUndefined()
    }

    await using restarted = await openWorkers(url, [], {
      originUrl: origin.url
    })
    await expect(restarted.workers.finishWorker(finish)).resolves.toBe(true)

    await expect(outcomeOf(restarted, threadId)).resolves.toMatchObject({
      value: 'success'
    })
    await expect(endStateOf(restarted, threadId)).resolves.toMatchObject({
      archived: true,
      report: 'Merged.'
    })
  })

  it('keeps the time of an outcome when a host restart runs the end of its worker again', async () => {
    const url = await createMigratedDatabase()
    const { threadId } = await workOnABranch(url, origin.url)
    const finish = {
      threadId,
      report: 'Merged.',
      outcome: { value: 'success' as const }
    }
    const outcomeBeforeTheRestart = await (async () => {
      await using agent = await openWorkers(url, [], {
        originUrl: origin.url
      })
      vi.spyOn(agent.host.sessions, 'archive').mockRejectedValueOnce(
        new Error('The host stopped.')
      )
      await expect(agent.workers.finishWorker(finish)).rejects.toThrow(
        'The host stopped.'
      )

      return await outcomeOf(agent, threadId)
    })()

    await using restarted = await openWorkers(url, [], {
      originUrl: origin.url
    })
    await restarted.workers.finishWorker(finish)

    expect(outcomeBeforeTheRestart).toMatchObject({ value: 'success' })
    await expect(outcomeOf(restarted, threadId)).resolves.toStrictEqual(
      outcomeBeforeTheRestart
    )
  })
})
