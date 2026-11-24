import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { definePlugin } from '@tanstack/ai-harness'
import { createMigratedDatabase } from '#/testing/test-database.ts'
import { TEST_STARTER } from '#/testing/test-doubles.ts'
import { REPOSITORY } from './worker-fixtures.ts'
import {
  closeWorkerTestbed,
  openWorkers,
  openWorkerTestbed
} from './worker-testbed.ts'

function holdTheTurnStart() {
  const reached = Promise.withResolvers<null>()
  const released = Promise.withResolvers<null>()
  const plugin = definePlugin({
    name: 'test/hold-the-turn-start',
    setup: () => {
      return {
        onTurnStart: async () => {
          reached.resolve(null)
          await released.promise
        }
      }
    }
  })

  return {
    plugin,
    reached: reached.promise,
    release: () => {
      released.resolve(null)
    }
  }
}

describe('a host that stops', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('stops while the turn of a worker starts', async () => {
    const url = await createMigratedDatabase()
    const hold = holdTheTurnStart()
    await using agent = await openWorkers(url, [{ text: 'On it.' }], {
      plugins: [hold.plugin]
    })

    await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Fix the login.'
    })
    await hold.reached
    const closing = agent.host.close({ recoverable: true })
    hold.release()

    await expect(closing).resolves.toBeUndefined()
  })
})
