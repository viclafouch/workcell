import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { title } from '@tanstack/ai-harness/plugins'
import { createMigratedDatabase } from '#/testing/test-database.ts'
import {
  alwaysTitled,
  askOrchestrator,
  closeWorkerTestbed,
  openWorkers,
  openWorkerTestbed,
  ORCHESTRATOR_THREAD,
  TEST_THREAD_TITLE
} from '#/workers/__tests__/worker-testbed.ts'

const OWN_TITLE = 'Named by the project'

type OpenedWorkers = Awaited<ReturnType<typeof openWorkers>>

async function titleOfThread(agent: OpenedWorkers) {
  const entry = await agent.host.sessions.get({ threadId: ORCHESTRATOR_THREAD })

  return entry?.title
}

describe('the title of a bot thread', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('comes from its first message, next to the turn', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(url, [{ text: 'On it.' }])

    await askOrchestrator(agent, { message: 'Take TASK-7.' })

    await expect
      .poll(() => {
        return titleOfThread(agent)
      })
      .toBe(TEST_THREAD_TITLE)
  })

  it('comes from the title plugin the project gives instead', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(url, [{ text: 'On it.' }], {
      orchestratorTitle: title({ adapter: alwaysTitled(OWN_TITLE) })
    })

    await askOrchestrator(agent, { message: 'Take TASK-7.' })

    await expect
      .poll(() => {
        return titleOfThread(agent)
      })
      .toBe(OWN_TITLE)
  })

  it('stays unset when the project turns titles off', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(url, [{ text: 'On it.' }], {
      orchestratorTitle: null
    })

    await askOrchestrator(agent, { message: 'Take TASK-7.' })

    expect(await titleOfThread(agent)).toBeUndefined()
  })
})
