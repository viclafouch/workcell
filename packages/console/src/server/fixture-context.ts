import { setTimeout as sleep } from 'node:timers/promises'
import { createHarnessHost, defineHarness } from '@tanstack/ai-harness'
import { title } from '@tanstack/ai-harness/plugins'
import { createHarnessHandler } from '@tanstack/ai-harness/server'
import { memoryPersistence } from '@tanstack/ai-persistence'
import {
  fakeText,
  type FakeResponse,
  type FakeResponseStep
} from '@tanstack/ai/testing'
import {
  createHostFreeSandbox,
  defineTestWorker,
  SILENT_HOST_LOGGER,
  TEST_STARTER
} from '@workcell/core/testing'
import { DEFAULT_BRAND_NAME } from '#/constants/brand.ts'
import type { ConsoleContext } from './console-context.ts'
import {
  BOT_FIXTURE_THREAD,
  FIXTURE_DIFF,
  FIXTURE_FEEDBACK,
  FIXTURE_QUEUE,
  FIXTURE_TRACKER,
  FIXTURE_WORKERS,
  LIVE_FIXTURE_THREAD
} from './fixtures.ts'
import { STDERR_LOGGER } from './stderr-logger.ts'

const STEP_PAUSE_MS = 1200

const TOKENS_PER_SECOND = 40

const paced = (step: FakeResponse): FakeResponseStep => {
  return async () => {
    await sleep(STEP_PAUSE_MS)

    return step
  }
}

const WORKER_TURN: FakeResponseStep[] = [
  paced({
    thinking: 'The sign-in page drops the page the visitor asked for.',
    toolCalls: [
      {
        name: 'todo_write',
        input: {
          todos: [
            { text: 'Read how the sign-in page redirects', status: 'done' },
            {
              text: 'Keep the requested path through sign-in',
              status: 'in_progress'
            },
            { text: 'Run the auth tests', status: 'pending' }
          ]
        }
      }
    ]
  }),
  paced({
    toolCalls: [
      {
        name: 'write_file',
        input: {
          path: 'src/auth/redirect.ts',
          content:
            "export const afterSignIn = (requested: string | null) => {\n  if (requested === null || !requested.startsWith('/')) {\n    return '/'\n  }\n\n  return requested\n}\n"
        }
      }
    ]
  }),
  paced({
    toolCalls: [{ name: 'bash', input: { command: 'ls src/auth' } }]
  }),
  paced({
    text: 'The sign-in page now sends the visitor back to the page they asked for, and refuses any path that leaves the site.'
  })
]

const BOT_THREAD_TITLE = 'What runs this morning'

const BOT_TURN: FakeResponseStep[] = [
  {
    text: 'Three workers run now. Bravo waits for your answer on a command it wants to run.'
  }
]

export const createFixtureContext = async (): Promise<ConsoleContext> => {
  const host = createHarnessHost({
    persistence: memoryPersistence(),
    logger: SILENT_HOST_LOGGER
  })
  const workerModel = fakeText({ tokensPerSecond: TOKENS_PER_SECOND })
  workerModel.setResponses(WORKER_TURN)
  const botModel = fakeText({ tokensPerSecond: TOKENS_PER_SECOND })
  botModel.setResponses(BOT_TURN)
  const hostFree = await createHostFreeSandbox()
  const worker = defineTestWorker({ host, model: workerModel, hostFree })
  const titleModel = fakeText()
  titleModel.setResponses([{ text: BOT_THREAD_TITLE }])
  const bot = defineHarness({
    name: 'workcell/bot-fixture',
    adapter: botModel,
    plugins: () => {
      return [title({ adapter: titleModel })]
    }
  })
  const workerSession = await host.open(worker, {
    threadId: LIVE_FIXTURE_THREAD,
    user: TEST_STARTER
  })
  await workerSession.setPluginSetting({ key: 'mode', value: 'bypass' })
  const botSession = await host.open(bot, {
    threadId: BOT_FIXTURE_THREAD,
    user: TEST_STARTER
  })
  let turnStart: Promise<unknown> | null = null
  const startTurnOnFirstWatch = async (request: Request) => {
    const isAboutTheLiveThread =
      new URL(request.url).searchParams.get('threadId') === LIVE_FIXTURE_THREAD

    if (isAboutTheLiveThread) {
      turnStart ??= workerSession.send(
        'Send a signed-out visitor back to the page they asked for.'
      ).receipt
      await turnStart
    }
  }
  void botSession.send('What runs now?')
  const openAccess = { user: TEST_STARTER }
  const workerHandler = createHarnessHandler({
    host,
    harness: worker,
    openAccess
  })
  const botHandler = createHarnessHandler({ host, harness: bot, openAccess })

  return {
    brand: { name: DEFAULT_BRAND_NAME },
    logger: STDERR_LOGGER,
    harness: {
      worker: async (request) => {
        await startTurnOnFirstWatch(request)

        return workerHandler(request)
      },
      bot: async (request) => {
        return botHandler(request)
      }
    },
    workers: {
      view: async () => {
        return FIXTURE_WORKERS
      },
      inspect: async () => {
        return FIXTURE_WORKERS
      },
      diff: async (threadId) => {
        return threadId === LIVE_FIXTURE_THREAD ? FIXTURE_DIFF : null
      }
    },
    feedback: {
      recent: () => {
        return FIXTURE_FEEDBACK
      }
    },
    queue: {
      tracker: FIXTURE_TRACKER,
      read: async () => {
        return FIXTURE_QUEUE
      }
    },
    traceUrl: (threadId) => {
      return `http://127.0.0.1:6006/projects?thread=${threadId}`
    }
  }
}
