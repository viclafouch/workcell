import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect } from 'vitest'
import type { StreamChunk } from '@tanstack/ai'
import { definePlugin, type HarnessPlugin } from '@tanstack/ai-harness'
import {
  createSecrets,
  defineSandbox,
  defineWorkspace
} from '@tanstack/ai-sandbox'
import {
  fakeText,
  FakeTextAdapter,
  type FakeResponseStep
} from '@tanstack/ai/testing'
import type { ModelPricing } from '#/budget/budget.ts'
import type { BudgetLimits } from '#/budget/limits.ts'
import { workerMetadataSchema } from '#/session/metadata.ts'
import { createSandboxInstanceStore } from '#/store/sandbox-instance-store.ts'
import { createWorkerChangesStore } from '#/store/worker-changes-store.ts'
import type { WorkerObservability } from '#/telemetry/worker-telemetry.ts'
import { createHostFreeProvider } from '#/testing/host-free-sandbox.ts'
import { openTestDatabase } from '#/testing/test-database.ts'
import {
  ROOMY_LIMITS,
  TEST_MAX_RUNNING_TURNS,
  TEST_STARTER
} from '#/testing/test-doubles.ts'
import { openWorkcell } from '#/workcell.ts'
import type { WorkerTask } from '#/workers/workers.ts'
import {
  allowGit,
  bash,
  COLLEAGUE_THREAD_PREFIX,
  ENTRY_SKILL,
  FAKE_MODEL_PRICING,
  finishTask,
  HOST_GIT_IDENTITY,
  ORCHESTRATOR_NAME,
  RECORDING_WORKER_LOGGER,
  REPOSITORY,
  SANDBOX_SECRETS,
  SECOND_REPOSITORY,
  TEST_NAMES,
  WORK_ON_A_BRANCH
} from './worker-fixtures.ts'

type WorkerTestbed = {
  hostFree: Awaited<ReturnType<typeof createHostFreeProvider>>
  skillDir: string
}

const ENTRY_SKILL_TEXT =
  '---\nname: start-ticket\ndescription: Take a Linear ticket to a pull request.\n---\n\nRead the ticket first.\n'

let workerTestbed: WorkerTestbed | null = null

export async function openWorkerTestbed({ hasEntrySkill = false } = {}) {
  const hostFree = await createHostFreeProvider()
  const skillDir = await mkdtemp(join(tmpdir(), 'worker-skills-'))

  if (hasEntrySkill) {
    await mkdir(join(skillDir, ENTRY_SKILL))
    await writeFile(join(skillDir, ENTRY_SKILL, 'SKILL.md'), ENTRY_SKILL_TEXT)
  }

  workerTestbed = { hostFree, skillDir }
}

function openedWorkerTestbed() {
  if (workerTestbed === null) {
    throw new Error('Open the worker testbed in a beforeAll hook first.')
  }

  return workerTestbed
}

export function testbedHostFree() {
  return openedWorkerTestbed().hostFree
}

export async function closeWorkerTestbed() {
  const { hostFree, skillDir } = openedWorkerTestbed()
  await hostFree.destroy()
  await rm(skillDir, { recursive: true, force: true })
}

export function tellToStop(agent: OpenedWorkers, threadId: string) {
  return agent.workers.messageWorker({
    threadId,
    sender: TEST_STARTER,
    inputId: `slack:stop:${threadId}`,
    message: 'Close it.'
  })
}

export async function waitForArchive(agent: OpenedWorkers, threadId: string) {
  const view = await agent.host.observe(agent.harness, { threadId })
  await expect
    .poll(() => {
      return agent.host.sessions.get({ threadId })
    })
    .toMatchObject({ archived: true })
  await expect
    .poll(() => {
      return view.snapshot()
    })
    .toMatchObject({ status: 'idle' })
}

export type OpenedWorkers = Awaited<ReturnType<typeof openWorkers>>

export async function openWorkers(
  url: string,
  responses: FakeResponseStep[],
  {
    idleSandboxMs,
    originUrl,
    secondOriginUrl,
    holdSecondTurnStart = Promise.resolve(null),
    limits = ROOMY_LIMITS,
    orchestratorLimits = ROOMY_LIMITS,
    model = fakeText(),
    compactionModel = model,
    pricing = FAKE_MODEL_PRICING,
    starterIds = [TEST_STARTER.id],
    plugins = [],
    orchestratorPlugins = [],
    workerNames = TEST_NAMES,
    maxRunningTurns = TEST_MAX_RUNNING_TURNS,
    observability
  }: {
    idleSandboxMs?: number
    maxRunningTurns?: number
    originUrl?: string
    secondOriginUrl?: string
    holdSecondTurnStart?: Promise<null>
    limits?: BudgetLimits
    orchestratorLimits?: BudgetLimits
    model?: FakeTextAdapter<string>
    compactionModel?: FakeTextAdapter<string>
    pricing?: ModelPricing
    starterIds?: readonly string[]
    plugins?: readonly HarnessPlugin[]
    orchestratorPlugins?: readonly HarnessPlugin[]
    workerNames?: readonly string[]
    observability?: WorkerObservability
  } = {}
) {
  const testbed = openedWorkerTestbed()
  const database = openTestDatabase(url)
  model.setResponses(responses)
  const sandbox = defineSandbox({
    id: 'worker-test',
    provider: testbed.hostFree.provider,
    workspace: defineWorkspace({
      source:
        originUrl === undefined
          ? { type: 'none' }
          : { type: 'git', url: originUrl, ref: 'dev', depth: 'full' },
      secrets: createSecrets({
        GH_TOKEN: SANDBOX_SECRETS.GITHUB_TOKEN,
        NPM_TOKEN: SANDBOX_SECRETS.NPM_TOKEN,
        ASSETS_CDN_TOKEN: SANDBOX_SECRETS.ASSETS_CDN_TOKEN
      })
    }),
    lifecycle: { reuse: 'thread', snapshot: 'none' }
  })
  const secondSandbox = defineSandbox({
    id: 'worker-test-second',
    provider: testbed.hostFree.provider,
    workspace: defineWorkspace({
      source:
        secondOriginUrl === undefined
          ? { type: 'none' }
          : { type: 'git', url: secondOriginUrl, ref: 'dev', depth: 'full' }
    }),
    lifecycle: { reuse: 'thread', snapshot: 'none' }
  })
  let turnStarts = 0
  const holdSecondTurn = definePlugin({
    name: 'test/hold-second-turn',
    setup: () => {
      return {
        onTurnStart: async () => {
          turnStarts += 1

          if (turnStarts === 2) {
            await holdSecondTurnStart
          }
        }
      }
    }
  })

  try {
    const workcell = await openWorkcell({
      database,
      logger: RECORDING_WORKER_LOGGER,
      models: {
        orchestrator: model,
        worker: model,
        compaction: compactionModel
      },
      pricing,
      secrets: SANDBOX_SECRETS,
      sandboxes: { [REPOSITORY]: sandbox, [SECOND_REPOSITORY]: secondSandbox },
      sandboxProvider: {
        destroy: testbed.hostFree.provider.destroy,
        list: testbed.hostFree.list
      },
      library: {
        sandbox: defineSandbox({
          id: 'worker-test-library',
          provider: testbed.hostFree.provider,
          workspace: defineWorkspace({ source: { type: 'none' } }),
          lifecycle: { reuse: 'thread', snapshot: 'none' }
        }),
        repositories: {},
        pullIntervalMs: 60_000
      },
      senders: {
        starterIds,
        isColleagueThread: (threadId) => {
          return threadId.startsWith(COLLEAGUE_THREAD_PREFIX)
        }
      },
      orchestrator: {
        name: ORCHESTRATOR_NAME,
        limits: orchestratorLimits,
        plugins: orchestratorPlugins
      },
      gitIdentity: HOST_GIT_IDENTITY,
      workerNames,
      skillDirs: [testbed.skillDir],
      defaultLimits: limits,
      plugins: [holdSecondTurn, allowGit, ...plugins],
      maxRunningTurns,
      idleSandboxMs,
      observability
    })

    return {
      ...workcell,
      model,
      changes: createWorkerChangesStore(database),
      sandboxInstances: createSandboxInstanceStore(database),
      sandboxKey: (threadId: string) => {
        return sandbox.key({ threadId, runId: threadId })
      },
      crash: async () => {
        await workcell.host.close({ recoverable: true })
        await database.close()
      },
      [Symbol.asyncDispose]: async () => {
        await workcell[Symbol.asyncDispose]()
        await database.close()
      }
    }
  } catch (error) {
    await database.close()
    throw error
  }
}

export async function liveSandboxKeys() {
  const sandboxes = await testbedHostFree().list()

  return sandboxes.map(({ key }) => {
    return key
  })
}

export async function logTracesOf(url: string, inputId: string) {
  await using database = openTestDatabase(url)
  const [traces] = await database.query<{ count: number }>(
    'count the log traces of an input',
    `SELECT (SELECT count(*) FROM log_records WHERE record LIKE $1)
       + (SELECT count(*) FROM log_offers WHERE input_id = $2) AS count`,
    [`%${inputId}%`, inputId]
  )

  return Number(traces?.count)
}

export async function runWorkerUntilAPersonEndsIt(
  url: string,
  task: Omit<WorkerTask, 'starter'>
) {
  await using agent = await openWorkers(url, [{ text: 'On it.' }, finishTask()])
  const worker = await agent.workers.startWorker({
    starter: TEST_STARTER,
    ...task
  })
  await worker.firstTurn
  await tellToStop(agent, worker.threadId)
  await waitForArchive(agent, worker.threadId)

  return worker
}

export async function runWorkerThenStop(
  url: string,
  responses: FakeResponseStep[],
  task: Omit<WorkerTask, 'starter'>
) {
  await using agent = await openWorkers(url, responses)
  const worker = await agent.workers.startWorker({
    starter: TEST_STARTER,
    ...task
  })
  await worker.firstTurn

  return worker
}

export async function runWorkerThenCrash(
  url: string,
  responses: FakeResponseStep[],
  task: Omit<WorkerTask, 'starter'>
) {
  const agent = await openWorkers(url, responses)

  try {
    const worker = await agent.workers.startWorker({
      starter: TEST_STARTER,
      ...task
    })
    await worker.firstTurn

    return worker
  } finally {
    await agent.crash()
  }
}

export async function workOnABranch(
  url: string,
  originUrl: string,
  idleSandboxMs?: number
) {
  await using agent = await openWorkers(
    url,
    [{ text: 'On it.' }, bash(WORK_ON_A_BRANCH), { text: 'Changed.' }],
    { originUrl, idleSandboxMs }
  )
  const worker = await agent.workers.startWorker({
    repository: REPOSITORY,
    starter: TEST_STARTER,
    task: 'Work on a branch.'
  })
  await worker.firstTurn
  await using session = await agent.host.open(agent.harness, {
    user: TEST_STARTER,
    threadId: worker.threadId
  })
  await session.setPluginSetting({ key: 'mode', value: 'bypass' })
  await session.send('Change the files.')

  return worker
}

export async function endStateOf(agent: OpenedWorkers, threadId: string) {
  const entry = await agent.host.sessions.get({ threadId })
  const sandboxKeys = await liveSandboxKeys()
  const savedChanges = await agent.changes.load(threadId)
  const sandboxRecord = await agent.sandboxInstances.get(
    agent.sandboxKey(threadId)
  )

  return {
    archived: entry?.archived,
    report: workerMetadataSchema.parse(entry?.metadata).report,
    hasSandbox: sandboxKeys.includes(agent.sandboxKey(threadId)),
    hasSandboxRecord: sandboxRecord !== null,
    hasSavedChanges: savedChanges !== undefined
  }
}

export async function askOrchestrator(
  agent: OpenedWorkers,
  {
    user = TEST_STARTER,
    threadId = 'slack/CTEST/1.0001',
    inputId = 'slack:CTEST:1.0001',
    message = 'What runs?'
  } = {}
) {
  const events: StreamChunk[] = []
  const answer = await agent.orchestrator.ask({
    threadId,
    user,
    inputId,
    message,
    onEvent: (event) => {
      events.push(event)
    }
  })

  return { ...answer, events }
}
