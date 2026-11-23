import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMigratedDatabase } from '#/testing/test-database.ts'
import { TEST_STARTER } from '#/testing/test-doubles.ts'
import { REPOSITORY } from './worker-fixtures.ts'
import {
  closeWorkerTestbed,
  holdTheReleaseOfALog,
  openWorkers,
  openWorkerTestbed
} from './worker-testbed.ts'

describe('a reply to a worker', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('reaches the worker when it lands while the worker gives its log up', async () => {
    const url = await createMigratedDatabase()
    const release = holdTheReleaseOfALog()
    const answeredMessages: string[] = []
    await using agent = await openWorkers(
      url,
      [
        { text: 'Which button do I keep?' },
        ({ request }) => {
          answeredMessages.push(JSON.stringify(request.messages))

          return { text: 'I keep the old button.' }
        }
      ],
      { wrapDatabase: release.wrapDatabase }
    )
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Restyle the login.'
    })
    await release.holdReleaseOf(worker.threadId)

    await agent.workers.messageWorker({
      threadId: worker.threadId,
      sender: TEST_STARTER,
      inputId: 'slack:reply-during-release',
      message: 'Keep the old button.'
    })
    release.letReleaseGoOn()

    await expect
      .poll(() => {
        return answeredMessages.join('\n')
      })
      .toContain('Keep the old button.')
  })
})
