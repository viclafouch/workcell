import { afterAll, assert, beforeAll, describe, expect, it } from 'vitest'
import { createMigratedDatabase } from '#/testing/test-database.ts'
import { NoFreePlaceError } from '#/workers/workers.ts'
import {
  callTool,
  REPOSITORY,
  routedResponses,
  TICKET_START,
  toolResultsOf,
  TWO_NAMES
} from './worker-fixtures.ts'
import {
  askOrchestrator,
  closeWorkerTestbed,
  openWorkers,
  openWorkerTestbed
} from './worker-testbed.ts'

const SECOND_TICKET = {
  ...TICKET_START,
  task: 'Do the ticket TASK-8.',
  subject: 'TASK-8',
  inputId: 'TASK-8'
}

describe('the capacity of a project', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(closeWorkerTestbed)

  it('refuses a new worker once every place is taken, and still answers the worker of a task it already runs', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(url, [{ text: 'On it.' }])
    const first = await agent.workers.startWorker(TICKET_START)
    await first.firstTurn

    const refusal = await agent.workers
      .startWorker(SECOND_TICKET)
      .catch((error: unknown) => {
        return error
      })
    const again = await agent.workers.startWorker(TICKET_START)

    assert.instanceOf(refusal, NoFreePlaceError)
    expect(refusal.message).toBe(
      'The project runs 1 worker at most, and Alpha holds every place: a new worker starts once one of their tasks ends.'
    )
    expect(again).toMatchObject({ name: 'Alpha', isNew: false })
    await expect(agent.workers.freePlaces()).resolves.toBe(0)
    await expect(agent.workers.listWorkers()).resolves.toHaveLength(1)
  })

  it('tells the chat that every place is taken, and starts no worker', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      routedResponses(
        [
          callTool('start_worker', {
            repository: REPOSITORY,
            task: 'Do the ticket TASK-8.',
            subject: 'TASK-8'
          }),
          { text: 'Every place is taken.' }
        ],
        [{ text: 'On it.' }]
      )
    )
    const first = await agent.workers.startWorker(TICKET_START)
    await first.firstTurn

    const answer = await askOrchestrator(agent, { message: 'Take TASK-8.' })

    expect(toolResultsOf(answer.events).join('\n')).toContain(
      'Alpha holds every place: a new worker starts once one of their tasks ends.'
    )
    await expect(agent.workers.listWorkers()).resolves.toMatchObject([
      { subject: 'TASK-7' }
    ])
  })

  it('frees a place once a task ends, tells it once, and counts the same places after a host restart', async () => {
    const url = await createMigratedDatabase()
    let placesFreed = 0

    {
      await using agent = await openWorkers(
        url,
        [{ text: 'On it.' }, { text: 'On it.' }],
        { workerNames: TWO_NAMES }
      )
      const stopListening = agent.workers.onPlaceFree(() => {
        placesFreed += 1
      })
      const workers = await Promise.all([
        agent.workers.startWorker(TICKET_START),
        agent.workers.startWorker(SECOND_TICKET)
      ])
      await Promise.all(
        workers.map(({ firstTurn }) => {
          return firstTurn
        })
      )
      const [ended] = workers
      assert.isDefined(ended)
      const finish = {
        threadId: ended.threadId,
        report: 'Closed.',
        outcome: { value: 'manual' as const, cause: 'A person took it.' }
      }

      await agent.workers.finishWorker(finish)
      await agent.workers.finishWorker(finish)
      stopListening()

      await expect(agent.workers.freePlaces()).resolves.toBe(1)
    }

    await using restarted = await openWorkers(url, [], {
      workerNames: TWO_NAMES
    })

    expect(placesFreed).toBe(1)
    await expect(restarted.workers.freePlaces()).resolves.toBe(1)
  })
})
