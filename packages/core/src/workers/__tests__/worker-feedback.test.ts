import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMigratedDatabase } from '#/testing/test-database.ts'
import { REPOSITORY } from './worker-fixtures.ts'
import {
  closeWorkerTestbed,
  openWorkers,
  openWorkerTestbed,
  runWorkerThenStop
} from './worker-testbed.ts'

const REPORT = {
  kind: 'missing',
  impact: 'blocked',
  observed: 'No tool reads the logs of the staging deploy.',
  expected: 'A read-only tool that tails the deploy logs.',
  source: 'agent'
}

describe('the recent feedback of a host', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('lists a report that a worker sent before a host restart', async () => {
    const url = await createMigratedDatabase()
    await runWorkerThenStop(
      url,
      [
        { toolCalls: [{ name: 'send_feedback', input: REPORT }] },
        { text: 'Done.' }
      ],
      { repository: REPOSITORY, task: 'Read the deploy logs.' }
    )

    await using restarted = await openWorkers(url, [])

    expect(await restarted.listRecentFeedback()).toStrictEqual([
      expect.objectContaining(REPORT)
    ])
  })
})
