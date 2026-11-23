import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarnessHost } from '@tanstack/ai-harness'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { fakeText } from '@tanstack/ai/testing'
import type { WorkerMetadata } from '@workcell/core'
import {
  createHostFreeSandbox,
  defineTestWorker,
  SILENT_HOST_LOGGER,
  TEST_STARTER
} from '@workcell/core/testing'
import { taskPullRequest } from '#/plugins/task-pull-request.ts'

const PULL_REQUEST_URL = 'https://github.com/acme/app/pull/42'

const PULL_REQUEST_FACT = `The pull request of this task: ${PULL_REQUEST_URL}.`

const WORKER_METADATA: WorkerMetadata = {
  name: 'Alpha',
  task: 'Take TASK-7 to a pull request.',
  repository: 'acme/app',
  branch: 'task-7-login'
}

let hostFree: Awaited<ReturnType<typeof createHostFreeSandbox>>

async function systemPromptOf(metadata: WorkerMetadata) {
  const systemPrompts: string[] = []
  const model = fakeText()
  model.setResponses([
    (call) => {
      systemPrompts.push(JSON.stringify(call.request.systemPrompts))

      return { text: 'Waiting on review.' }
    }
  ])
  const host = createHarnessHost({
    persistence: memoryPersistence(),
    logger: SILENT_HOST_LOGGER
  })
  const worker = defineTestWorker({
    host,
    model,
    hostFree,
    plugins: [taskPullRequest]
  })
  const session = await host.open(worker, {
    threadId: 'worker-task-pull-request',
    user: TEST_STARTER
  })

  await session.updateIndexEntry(() => {
    return { metadata }
  })

  await session.send('Go on.')
  await host.close()

  return systemPrompts.join('\n')
}

describe('the pull request of a task', () => {
  beforeAll(async () => {
    hostFree = await createHostFreeSandbox()
  })

  afterAll(async () => {
    await hostFree.destroy()
  })

  it('shows the worker the pull request that the watcher recorded', async () => {
    const systemPrompt = await systemPromptOf({
      ...WORKER_METADATA,
      pullRequest: PULL_REQUEST_URL
    })

    expect(systemPrompt).toContain(PULL_REQUEST_FACT)
  })

  it('shows no pull request before the watcher records one', async () => {
    const systemPrompt = await systemPromptOf(WORKER_METADATA)

    expect(systemPrompt).not.toContain('The pull request of this task')
  })
})
