import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { fakeText, type FakeResponseStep } from '@tanstack/ai/testing'
import type { WorkerMetadata } from '@workcell/core'
import {
  createAgentHost,
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

function ghPrinting(output: string, exitCode = 0) {
  return `gh() { echo '${output}'; return ${exitCode}; }; `
}

function bashCall(command: string): FakeResponseStep {
  return { toolCalls: [{ name: 'bash', input: { command } }] }
}

async function runTurn(
  persistence: ReturnType<typeof memoryPersistence>,
  responses: FakeResponseStep[]
) {
  const systemPrompts: string[] = []
  const model = fakeText()
  model.setResponses(
    responses.map((response) => {
      return (call) => {
        systemPrompts.push(JSON.stringify(call.request.systemPrompts))

        return typeof response === 'function' ? response(call) : response
      }
    })
  )
  const host = createAgentHost({ persistence, logger: SILENT_HOST_LOGGER })
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

  await session.updateIndexEntry((current) => {
    return { metadata: current.metadata ?? WORKER_METADATA }
  })

  await session.setPluginSetting({ key: 'mode', value: 'bypass' })
  await session.send('Go on.')
  const entry = await session.indexEntry()
  await host.close()

  return { metadata: entry?.metadata, systemPrompt: systemPrompts.join('\n') }
}

describe('the pull request of a task', () => {
  beforeAll(async () => {
    hostFree = await createHostFreeSandbox()
  })

  afterAll(async () => {
    await hostFree.destroy()
  })

  it('records the pull request that gh pr create opens, and shows it to the worker after a restart', async () => {
    const persistence = memoryPersistence()

    const opening = await runTurn(persistence, [
      bashCall(
        `${ghPrinting(PULL_REQUEST_URL)}gh pr create --title "Fix the login"`
      ),
      { text: `Opened ${PULL_REQUEST_URL}` }
    ])
    const next = await runTurn(persistence, [{ text: 'Waiting on review.' }])

    expect(opening.systemPrompt).not.toContain(PULL_REQUEST_FACT)
    expect(opening.metadata).toMatchObject({ pullRequest: PULL_REQUEST_URL })
    expect(next.systemPrompt).toContain(PULL_REQUEST_FACT)
  })

  it.each([
    [
      'a gh pr create that fails',
      `${ghPrinting(PULL_REQUEST_URL, 1)}gh pr create --title "Fix the login"`
    ],
    ['a command that only prints the link', `echo '${PULL_REQUEST_URL}'`],
    [
      'a pull request of another repository',
      `${ghPrinting('https://github.com/other/app/pull/7')}gh pr create --title "Fix"`
    ]
  ])('records nothing after %s', async (_case, command) => {
    const { metadata, systemPrompt } = await runTurn(memoryPersistence(), [
      bashCall(command),
      { text: 'Done.' }
    ])

    expect(metadata).not.toHaveProperty('pullRequest')
    expect(systemPrompt).not.toContain('The pull request of this task')
  })
})
