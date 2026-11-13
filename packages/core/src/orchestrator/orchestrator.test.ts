import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SENDER_REFUSAL } from '#/host/allowed-senders.ts'
import { createMigratedDatabase } from '#/store/test-database.ts'
import {
  LONG_HOST_TOOL,
  longHostTool,
  OVERLOADED_MODEL_ERROR,
  TEST_STARTER
} from '#/workers/test-doubles.ts'
import {
  budgetEndsOf,
  callTool,
  COLLEAGUE,
  holdUntilStopped,
  ORCHESTRATOR_NAME,
  REPOSITORY,
  routedResponses,
  textOf,
  TICKET_START,
  toolResultsOf
} from '#/workers/worker-fixtures.ts'
import {
  askOrchestrator,
  closeWorkerTestbed,
  openWorkers,
  openWorkerTestbed
} from '#/workers/worker-testbed.ts'

describe('the orchestrator', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('answers what runs from the live registry', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      routedResponses(
        [callTool('list_workers'), { text: 'Alpha works on TASK-7.' }],
        [{ text: 'On it.' }]
      )
    )
    const worker = await agent.workers.startWorker(TICKET_START)
    await worker.firstTurn

    const answer = await askOrchestrator(agent)

    expect(answer).toMatchObject({ ownsTurn: true, outcome: 'completed' })
    expect(toolResultsOf(answer.events).join('\n')).toContain('"name":"Alpha"')
    expect(textOf(answer.events)).toBe('Alpha works on TASK-7.')
  })

  it('retries a model call that the provider refuses as overloaded, in the same turn', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      routedResponses([
        { error: OVERLOADED_MODEL_ERROR },
        { text: 'Back after the retry.' }
      ])
    )

    const answer = await askOrchestrator(agent)

    expect(answer).toMatchObject({ outcome: 'completed' })
    expect(textOf(answer.events)).toBe('Back after the retry.')
  })

  it('cuts a long tool result before the model reads it', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      routedResponses([callTool(LONG_HOST_TOOL), { text: 'Read it.' }]),
      { orchestratorPlugins: [longHostTool] }
    )

    const answer = await askOrchestrator(agent)

    expect(toolResultsOf(answer.events).join('\n')).toMatch(
      /\[Output cut\. Showing the first \d+ of 3000 lines, 51200 of 105000 bytes\.\]$/u
    )
  })

  it('starts a worker for an allowed starter, as that starter, and the worker outlives the thread', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      routedResponses(
        [
          callTool('start_worker', {
            repository: REPOSITORY,
            task: 'Do the ticket TASK-7.',
            subject: 'TASK-7'
          }),
          { text: 'Alpha takes it.' }
        ],
        [{ text: 'On it.' }]
      )
    )

    const answer = await askOrchestrator(agent, { message: 'Take TASK-7.' })

    expect(toolResultsOf(answer.events).join('\n')).toContain(
      `Alpha starts the task on ${REPOSITORY}.`
    )
    await expect(agent.workers.listWorkers()).resolves.toMatchObject([
      { name: 'Alpha', subject: 'TASK-7' }
    ])
    const { entries } = await agent.host.sessions.list({
      harness: agent.harness.name
    })
    expect(entries).toMatchObject([
      { members: [{ userId: TEST_STARTER.id, role: 'owner' }] }
    ])
  })

  it('reads the library and changes no file, in plan mode', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      routedResponses([
        callTool('write_file', { path: 'notes.md', content: 'Hello.' }),
        { text: 'I cannot write.' }
      ])
    )

    const answer = await askOrchestrator(agent, { message: 'Write a note.' })

    expect(toolResultsOf(answer.events).join('\n')).toContain('plan mode')
  })

  it('takes a reply during its turn as a steer of that turn', async () => {
    const url = await createMigratedDatabase()
    const started = Promise.withResolvers<null>()
    const release = Promise.withResolvers<null>()
    const secondCallMessages: string[] = []
    await using agent = await openWorkers(
      url,
      routedResponses([
        async () => {
          started.resolve(null)
          await release.promise

          return callTool('list_workers')
        },
        ({ request }) => {
          secondCallMessages.push(JSON.stringify(request.messages))

          return { text: 'Nothing runs, and TASK-7 is free.' }
        }
      ])
    )

    const first = askOrchestrator(agent)
    await started.promise
    const steer = askOrchestrator(agent, {
      inputId: 'slack:CTEST:1.0002',
      message: 'And TASK-7?'
    })
    await expect
      .poll(async () => {
        const view = await agent.host.observe(agent.orchestrator.harness, {
          threadId: 'slack/CTEST/1.0001'
        })
        const { waitingInputs = [] } = await view.snapshot()

        return waitingInputs
      })
      .toHaveLength(1)
    release.resolve(null)

    await expect(steer).resolves.toMatchObject({ ownsTurn: false })
    await expect(first).resolves.toMatchObject({ ownsTurn: true })
    expect(secondCallMessages.join('\n')).toContain('And TASK-7?')
  })

  it('stops its running turn', async () => {
    const url = await createMigratedDatabase()
    const started = Promise.withResolvers<null>()
    await using agent = await openWorkers(
      url,
      routedResponses([holdUntilStopped(started)])
    )
    const threadId = 'slack/CTEST/1.0001'

    const answer = askOrchestrator(agent)
    await started.promise

    await expect(
      agent.orchestrator.stop({ threadId, user: TEST_STARTER })
    ).resolves.toBe(true)
    await expect(answer).resolves.toMatchObject({ outcome: 'aborted' })
    await expect(
      agent.orchestrator.stop({ threadId, user: TEST_STARTER })
    ).resolves.toBe(false)
  })

  it('ends its turn at its budget with no question, and stops each next turn before a model call', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      routedResponses([callTool('list_workers')]),
      { orchestratorLimits: { maxCostUsd: 0.000_01 } }
    )

    const answer = await askOrchestrator(agent)
    const next = await askOrchestrator(agent, {
      inputId: 'slack:CTEST:1.0002',
      message: 'And now?'
    })

    expect(answer.waits).toStrictEqual([])
    expect(budgetEndsOf(answer.events)).toStrictEqual([
      expect.stringContaining(
        `${ORCHESTRATOR_NAME} used its budget for this conversation`
      )
    ])
    expect(budgetEndsOf(next.events)).toHaveLength(1)
    expect(agent.model.state.callCount).toBe(1)
  })

  it('holds a thread once a message opened it, also after a host restart', async () => {
    const url = await createMigratedDatabase()
    const threadId = 'slack/CTEST/1.0001'

    {
      await using agent = await openWorkers(
        url,
        routedResponses([{ text: 'Nothing runs.' }])
      )
      await expect(agent.orchestrator.holds(threadId)).resolves.toBe(false)
      await askOrchestrator(agent, { threadId })
    }

    await using restarted = await openWorkers(url, [])
    await expect(restarted.orchestrator.holds(threadId)).resolves.toBe(true)
  })
})

describe('who the orchestrator works for', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('refuses work to a colleague in a sentence, and names the worker already on the topic', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      routedResponses(
        [
          callTool('start_worker', {
            repository: REPOSITORY,
            task: 'Do the ticket TASK-7.',
            subject: 'TASK-7'
          }),
          { text: 'Non.' },
          callTool('stop_worker', { name: 'Alpha' }),
          { text: 'Non.' }
        ],
        [{ text: 'On it.' }]
      )
    )
    const worker = await agent.workers.startWorker(TICKET_START)
    await worker.firstTurn

    const start = await askOrchestrator(agent, {
      user: COLLEAGUE,
      message: 'Take TASK-7.'
    })
    const stop = await askOrchestrator(agent, {
      user: COLLEAGUE,
      inputId: 'slack:CTEST:1.0002',
      message: 'Stop Alpha.'
    })

    expect(toolResultsOf(start.events).join('\n')).toContain(
      'The user of this message may not start work. Only an allowed starter can start, steer or stop a worker. Alpha already works on TASK-7: follow it in its thread.'
    )
    expect(toolResultsOf(stop.events).join('\n')).toContain(
      'The user of this message may not stop a worker.'
    )
    await expect(agent.workers.listWorkers()).resolves.toHaveLength(1)
  })

  it('refuses the message of a colleague outside the colleague threads, and answers its starter there', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      routedResponses([{ text: 'Nothing runs.' }])
    )
    const otherThread = {
      threadId: 'slack/COTHER/1.0001',
      inputId: 'slack:COTHER:1.0001'
    }

    await expect(
      askOrchestrator(agent, { ...otherThread, user: COLLEAGUE })
    ).rejects.toThrow(SENDER_REFUSAL)
    expect(agent.model.state.callCount).toBe(0)

    await expect(askOrchestrator(agent, otherThread)).resolves.toMatchObject({
      outcome: 'completed'
    })
  })

  it('lets a user start work once config adds them to the allowed starters', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      routedResponses(
        [
          callTool('start_worker', {
            repository: REPOSITORY,
            task: 'Fix the login.'
          }),
          { text: 'Alpha takes it.' }
        ],
        [{ text: 'On it.' }]
      ),
      { starterIds: [TEST_STARTER.id, COLLEAGUE.id] }
    )

    await askOrchestrator(agent, { user: COLLEAGUE, message: 'Fix the login.' })

    await expect(agent.workers.listWorkers()).resolves.toMatchObject([
      { name: 'Alpha' }
    ])
  })

  it('runs the reply of a colleague during the turn of a starter as its own turn, under the colleague', async () => {
    const url = await createMigratedDatabase()
    const started = Promise.withResolvers<null>()
    const release = Promise.withResolvers<null>()
    await using agent = await openWorkers(
      url,
      routedResponses([
        async () => {
          started.resolve(null)
          await release.promise

          return { text: 'Nothing runs.' }
        },
        callTool('start_worker', {
          repository: REPOSITORY,
          task: 'Do the ticket TASK-9.',
          subject: 'TASK-9'
        }),
        { text: 'Non.' }
      ])
    )

    const first = askOrchestrator(agent)
    await started.promise
    const colleague = askOrchestrator(agent, {
      user: COLLEAGUE,
      inputId: 'slack:CTEST:1.0002',
      message: 'Start a worker on TASK-9.'
    })
    await expect
      .poll(async () => {
        const view = await agent.host.observe(agent.orchestrator.harness, {
          threadId: 'slack/CTEST/1.0001'
        })
        const { waitingInputs = [] } = await view.snapshot()

        return waitingInputs
      })
      .toHaveLength(1)
    release.resolve(null)
    const colleagueAnswer = await colleague

    await expect(first).resolves.toMatchObject({ ownsTurn: true })
    expect(colleagueAnswer.ownsTurn).toBe(true)
    expect(toolResultsOf(colleagueAnswer.events).join('\n')).toContain(
      'may not start work'
    )
    await expect(agent.workers.listWorkers()).resolves.toStrictEqual([])
  })
})
