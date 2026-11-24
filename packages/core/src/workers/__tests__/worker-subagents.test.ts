import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ModelMessage, TextOptions } from '@tanstack/ai'
import type { FakeResponseStep } from '@tanstack/ai/testing'
import { createMigratedDatabase } from '#/testing/test-database.ts'
import { TEST_STARTER } from '#/testing/test-doubles.ts'
import {
  callTool,
  PROVIDER_COST_USD,
  ProviderCostFake,
  REPOSITORY
} from './worker-fixtures.ts'
import {
  closeWorkerTestbed,
  openWorkers,
  openWorkerTestbed
} from './worker-testbed.ts'

const STANDARDS_TASK = 'Review the diff against the coding standards.'

const SPEC_TASK = 'Review the diff against the issue.'

const WORKER_CALL_AND_TWO_SUBAGENT_CALLS = 3

function isWorkerCall(request: TextOptions) {
  return JSON.stringify(request.systemPrompts).includes('AGENTS.md')
}

function hasToolResults(request: TextOptions) {
  return request.messages.some(({ role }) => {
    return role === 'tool'
  })
}

function reviewInTwoSubagents(childCalls: ModelMessage[][]): FakeResponseStep {
  return ({ request }) => {
    if (!isWorkerCall(request)) {
      childCalls.push(request.messages)

      return { text: 'No finding.' }
    }

    return hasToolResults(request)
      ? { text: 'Reviewed.' }
      : {
          toolCalls: [
            ...callTool('subagent', { task: STANDARDS_TASK }).toolCalls,
            ...callTool('subagent', { task: SPEC_TASK }).toolCalls
          ]
        }
  }
}

describe('the subagents of a worker', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('gives each subagent its task only, none of the session of the worker', async () => {
    const childCalls: ModelMessage[][] = []
    const respond = reviewInTwoSubagents(childCalls)
    await using agent = await openWorkers(await createMigratedDatabase(), [
      respond,
      respond,
      respond,
      respond
    ])

    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Review the change before the pull request.'
    })
    await worker.firstTurn

    expect(
      childCalls
        .map((messages) => {
          return JSON.stringify(
            messages.map(({ role, content }) => {
              return { role, content }
            })
          )
        })
        .toSorted()
    ).toStrictEqual([
      JSON.stringify([{ role: 'user', content: STANDARDS_TASK }]),
      JSON.stringify([{ role: 'user', content: SPEC_TASK }])
    ])
  })

  it('counts the spend of its subagents in the budget of the turn', async () => {
    const respond = reviewInTwoSubagents([])
    await using agent = await openWorkers(
      await createMigratedDatabase(),
      [respond, respond, respond, respond],
      {
        model: new ProviderCostFake('fake-model', {}),
        limits: { maxCostUsd: PROVIDER_COST_USD * 2 }
      }
    )

    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Review the change before the pull request.'
    })
    await worker.firstTurn
    const view = await agent.host.observe(agent.harness, {
      threadId: worker.threadId
    })

    expect(agent.model.state.callCount).toBe(WORKER_CALL_AND_TWO_SUBAGENT_CALLS)
    await expect(view.snapshot()).resolves.toMatchObject({
      pendingWaits: [{ kind: 'human', turn: true }]
    })
  })
})
