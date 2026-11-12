import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fakeText, FakeTextAdapter } from '@tanstack/ai/testing'
import { createMigratedDatabase } from '#core/store/test-database'
import type { WorkerObservability } from '#core/telemetry/worker-telemetry'
import { TEST_STARTER } from './test-doubles.ts'
import {
  budgetEndsOf,
  COMPACTION_MODEL,
  COMPACTION_PRICING,
  LOGIN_TASK,
  LONG_READ,
  LONG_READ_LINE,
  ORCHESTRATOR_NAME,
  recordSpans,
  REPOSITORY,
  routedResponses,
  spanCost,
  spanTokens,
  SPENT_AFTER_A_LONG_SUMMARY,
  TICKET_START,
  TOKENS_PER_PRICE_UNIT
} from './worker-fixtures.ts'
import {
  askOrchestrator,
  closeWorkerTestbed,
  openWorkers,
  openWorkerTestbed,
  runWorkerThenStop
} from './worker-testbed.ts'

function summaryModel() {
  const model = fakeText<string>({ model: COMPACTION_MODEL })
  model.setResponses(
    Array.from({ length: 4 }, () => {
      return { text: 'The summary of the work so far.' }
    })
  )

  return model
}

async function readALongFile(
  url: string,
  compactionModel: FakeTextAdapter<string>,
  observability?: WorkerObservability
) {
  await using agent = await openWorkers(
    url,
    [{ text: 'On it.' }, { text: 'Read.' }],
    { compactionModel, pricing: COMPACTION_PRICING, observability }
  )
  const worker = await agent.workers.startWorker(TICKET_START)
  await worker.firstTurn
  await using session = await agent.host.open(agent.harness, {
    user: TEST_STARTER,
    threadId: worker.threadId
  })
  await session.send(LONG_READ)

  return worker.threadId
}

describe('the compaction of a worker', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('keeps its task word for word in the model request, through two compactions in a session reopened after a host restart, and after another restart', async () => {
    const url = await createMigratedDatabase()
    const compactionModel = summaryModel()
    const { threadId } = await runWorkerThenStop(url, [{ text: 'On it.' }], {
      repository: REPOSITORY,
      task: LOGIN_TASK
    })

    {
      await using reopened = await openWorkers(url, [{ text: 'Read.' }], {
        compactionModel,
        pricing: COMPACTION_PRICING
      })
      await using session = await reopened.host.open(reopened.harness, {
        user: TEST_STARTER,
        threadId
      })
      await session.send(LONG_READ)
    }

    const requests: string[] = []
    await using restarted = await openWorkers(
      url,
      [
        ({ request }) => {
          requests.push(JSON.stringify(request.messages))

          return { text: 'Done.' }
        }
      ],
      { compactionModel, pricing: COMPACTION_PRICING }
    )
    await using session = await restarted.host.open(restarted.harness, {
      user: TEST_STARTER,
      threadId
    })
    await session.send('Go on.')

    expect(compactionModel.state.callCount).toBe(2)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toContain(LOGIN_TASK)
    expect(requests[0]).not.toContain(LONG_READ_LINE)
  })

  it('counts each summary call in its budget, across a host restart', async () => {
    const url = await createMigratedDatabase()
    const compactionModel = summaryModel()
    const threadId = await readALongFile(url, compactionModel)
    await using restarted = await openWorkers(url, [{ text: 'Done.' }], {
      compactionModel,
      pricing: COMPACTION_PRICING,
      limits: SPENT_AFTER_A_LONG_SUMMARY
    })
    await using session = await restarted.host.open(restarted.harness, {
      user: TEST_STARTER,
      threadId
    })
    await session.send('Go on.')

    const { pendingWaits } = session.snapshot()

    expect(compactionModel.state.callCount).toBe(2)
    expect(restarted.model.state.callCount).toBe(0)
    expect(pendingWaits).toMatchObject([{ kind: 'human' }])
    expect(pendingWaits[0]?.message).toContain('Alpha used its budget')
  })

  it('traces each summary call in its thread, with its tokens, its cost, its name and its task', async () => {
    const url = await createMigratedDatabase()
    const compactionModel = summaryModel()
    const { observability, finishedSpans } = recordSpans()
    const threadId = await readALongFile(url, compactionModel, observability)

    const summaries = finishedSpans().filter(({ name }) => {
      return name === `chat ${COMPACTION_MODEL}`
    })

    expect(summaries).toHaveLength(2)

    for (const summary of summaries) {
      expect(summary.attributes).toMatchObject({
        'gen_ai.agent.name': 'Alpha',
        'gen_ai.conversation.id': threadId,
        'workcell.task.subject': 'TASK-7'
      })
      expect(spanCost(summary)).toBeCloseTo(
        spanTokens(summary) / TOKENS_PER_PRICE_UNIT
      )
    }
  })

  it('counts each summary call in the budget of the orchestrator', async () => {
    const url = await createMigratedDatabase()
    const compactionModel = summaryModel()
    await using agent = await openWorkers(
      url,
      routedResponses([{ text: 'Nothing runs.' }, { text: 'Read.' }]),
      {
        compactionModel,
        pricing: COMPACTION_PRICING,
        orchestratorLimits: SPENT_AFTER_A_LONG_SUMMARY
      }
    )

    await askOrchestrator(agent)
    await askOrchestrator(agent, {
      inputId: 'slack:CTEST:1.0002',
      message: LONG_READ
    })
    const next = await askOrchestrator(agent, {
      inputId: 'slack:CTEST:1.0003',
      message: 'And now?'
    })

    expect(compactionModel.state.callCount).toBe(2)
    expect(agent.model.state.callCount).toBe(2)
    expect(budgetEndsOf(next.events)).toStrictEqual([
      expect.stringContaining(
        `${ORCHESTRATOR_NAME} used its budget for this conversation`
      )
    ])
  })
})
