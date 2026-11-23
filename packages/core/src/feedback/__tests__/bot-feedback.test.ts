import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FeedbackReport } from '#/feedback/feedback.ts'
import { createMigratedDatabase } from '#/testing/test-database.ts'
import {
  callTool,
  COLLEAGUE,
  COLLEAGUE_THREAD_PREFIX,
  ORCHESTRATOR_NAME,
  routedResponses
} from '#/workers/__tests__/worker-fixtures.ts'
import {
  askOrchestrator,
  closeWorkerTestbed,
  openWorkers,
  openWorkerTestbed
} from '#/workers/__tests__/worker-testbed.ts'

const COLLEAGUE_THREAD = `${COLLEAGUE_THREAD_PREFIX}3.0001`

describe('the feedback of the bot', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('files the report a colleague asks for, under the name of that colleague', async () => {
    const delivered: FeedbackReport[] = []
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      routedResponses([
        callTool('send_feedback', {
          kind: 'missing',
          impact: 'blocked',
          observed: 'No tool lists the open pull requests of a repository.',
          expected: 'A tool that lists them, with their checks.',
          source: 'user'
        }),
        { text: 'Reported.' }
      ]),
      {
        feedback: {
          deliver: async (report) => {
            delivered.push(report)
          }
        }
      }
    )

    await askOrchestrator(agent, {
      user: COLLEAGUE,
      threadId: COLLEAGUE_THREAD,
      inputId: 'slack:CTEST:3.0001',
      message: 'Report that you cannot list the open pull requests.'
    })

    expect(delivered).toStrictEqual([
      expect.objectContaining({
        source: 'user',
        reporter: COLLEAGUE.id,
        harness: 'workcell/orchestrator',
        agent: ORCHESTRATOR_NAME,
        threadId: COLLEAGUE_THREAD
      })
    ])
  })
})
