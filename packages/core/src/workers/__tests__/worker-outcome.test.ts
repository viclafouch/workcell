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
  ASK_IF_THE_REVIEW_IS_ENOUGH,
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
  runWorkerThenStop,
  tellToStop,
  waitForArchive,
  workOnABranch
} from './worker-testbed.ts'

const REVIEW_SCREENSHOT = {
  name: 'review.png',
  mimeType: 'image/png',
  read: async () => {
    return new TextEncoder().encode('review bytes')
  }
}

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

describe('the success of a task with no pull request', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('ends as a success when a person accepts the work, with their own words as its cause and not the words of the worker', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(url, [
      { text: 'The review is posted.' },
      finishTask({
        report: undefined,
        outcome: 'success',
        cause: 'The work is done.'
      })
    ])
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Review the login.'
    })
    await worker.firstTurn

    await agent.workers.messageWorker({
      threadId: worker.threadId,
      sender: TEST_STARTER,
      inputId: 'slack:accept',
      message: 'Looks good, thanks.'
    })
    await waitForArchive(agent, worker.threadId)

    await expect(outcomeOf(agent, worker.threadId)).resolves.toMatchObject({
      value: 'success',
      cause: 'Looks good, thanks.'
    })
    await expect(agent.viewWorkers()).resolves.toMatchObject([
      {
        threadId: worker.threadId,
        phase: 'finished',
        outcome: { value: 'success', cause: 'Looks good, thanks.' }
      }
    ])
  })

  it('ends as a success when a person accepts the work in the answer to its question, after a host restart, with that answer as its cause', async () => {
    const url = await createMigratedDatabase()
    const asker = await runWorkerThenStop(url, [ASK_IF_THE_REVIEW_IS_ENOUGH], {
      repository: REPOSITORY,
      task: 'Review the login.'
    })
    await using restarted = await openWorkers(url, [
      finishTask({
        report: undefined,
        outcome: 'success',
        cause: 'The work is done.'
      })
    ])

    await restarted.workers.messageWorker({
      threadId: asker.threadId,
      sender: TEST_STARTER,
      inputId: 'slack:answer',
      message: 'Done, ship it.'
    })
    await waitForArchive(restarted, asker.threadId)

    await expect(outcomeOf(restarted, asker.threadId)).resolves.toMatchObject({
      value: 'success',
      cause: 'Done, ship it.'
    })
  })

  it('refuses a success when the person gave no words, such as an answer made only of files, and keeps the worker live', async () => {
    const url = await createMigratedDatabase()
    const answeredMessages: string[] = []
    const asker = await runWorkerThenStop(url, [ASK_IF_THE_REVIEW_IS_ENOUGH], {
      repository: REPOSITORY,
      task: 'Review the login.'
    })
    await using restarted = await openWorkers(url, [
      finishTask({ report: undefined, outcome: 'success', cause: 'Done.' }),
      ({ request }) => {
        answeredMessages.push(JSON.stringify(request.messages))

        return { text: 'I ask in words.' }
      }
    ])

    await restarted.workers.messageWorker({
      threadId: asker.threadId,
      sender: TEST_STARTER,
      inputId: 'slack:answer',
      message: '',
      files: [REVIEW_SCREENSHOT]
    })

    await expect
      .poll(() => {
        return answeredMessages.join('\n')
      })
      .toContain('says in words that the work is done')
    await expect(outcomeOf(restarted, asker.threadId)).resolves.toBeUndefined()
  })

  it('refuses a success once the task has a pull request, keeps the worker live, and gives the model the reason', async () => {
    const url = await createMigratedDatabase()
    const answeredMessages: string[] = []
    await using agent = await openWorkers(url, [
      { text: 'The pull request is open.' },
      finishTask({ report: undefined, outcome: 'success', cause: 'Merged.' }),
      ({ request }) => {
        answeredMessages.push(JSON.stringify(request.messages))

        return { text: 'I wait for the merge.' }
      }
    ])
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Fix the login.'
    })
    await worker.firstTurn
    await agent.workers.updateWorker({
      threadId: worker.threadId,
      metadata: { pullRequest: 'https://github.com/acme/app/pull/42' }
    })

    await agent.workers.messageWorker({
      threadId: worker.threadId,
      sender: TEST_STARTER,
      inputId: 'slack:accept',
      message: 'Looks good, thanks.'
    })

    await expect
      .poll(() => {
        return answeredMessages.join('\n')
      })
      .toContain('https://github.com/acme/app/pull/42 decides')
    await expect(agent.workers.listWorkers()).resolves.toMatchObject([
      { threadId: worker.threadId }
    ])
    await expect(outcomeOf(agent, worker.threadId)).resolves.toBeUndefined()
  })
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
