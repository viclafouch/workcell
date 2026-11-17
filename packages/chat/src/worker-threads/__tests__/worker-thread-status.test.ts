import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { definePlugin, type HarnessPlugin } from '@tanstack/ai-harness'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { WorkerSandboxSetup } from '@workcell/core'
import { openSlackChat } from '#/__tests__/test-doubles.ts'
import type { ChatSurface } from '#/connection/chat-surface.ts'
import {
  CLEARED_LINE,
  COLLEAGUE,
  STARTED_WORKER,
  STARTER,
  TASK_7_METADATA,
  WORKER_THREAD,
  createTestThreads,
  delayStatus,
  recordSurface,
  recordWorkers,
  statusCalls,
  threadLine,
  threadStatus,
  watchSurface,
  workerSessionOpener
} from './worker-thread-fixtures.ts'

const STATUS_LINE_RENEWAL_MS = 60_000

const SETUP_EVENT_SETTLE_MS = 20

const IDLE_WORKER = { ...STARTED_WORKER, liveStatus: 'idle' as const }

const SETUP_LINE = threadLine('Getting my sandbox ready.')

function sandboxSetupUntil(released: Promise<null>, reached: () => void) {
  return definePlugin({
    name: 'test/sandbox-setup',
    setup: (setupContext) => {
      return {
        onTurnStart: async () => {
          setupContext.emit(WorkerSandboxSetup, { step: 'create' })
          setupContext.emit(WorkerSandboxSetup, {
            step: 'setup',
            commands: ['pnpm install']
          })
          reached()
          await released
          setupContext.emit(WorkerSandboxSetup, { step: 'done' })
        }
      }
    }
  })
}

const failingSandboxSetup = definePlugin({
  name: 'test/failing-sandbox-setup',
  setup: (setupContext) => {
    return {
      onTurnStart: async () => {
        setupContext.emit(WorkerSandboxSetup, { step: 'create' })
        setupContext.emit(WorkerSandboxSetup, { step: 'done' })
        throw new Error('The sandbox did not start.')
      }
    }
  }
})

async function openWorkerInItsThread(
  surface: ChatSurface,
  plugin: HarnessPlugin,
  responses: Parameters<ReturnType<typeof workerSessionOpener>>[2]
) {
  const worker = await workerSessionOpener({ plugins: [plugin] })(
    memoryPersistence(),
    surface,
    responses
  )
  const opened = await worker.threads.open(TASK_7_METADATA)
  await worker.session.updateIndexEntry({
    metadata: { ...TASK_7_METADATA, ...opened }
  })

  return worker
}

function replyRoute(
  surface: ChatSurface,
  workers: ReturnType<typeof recordWorkers>['workers']
) {
  const threads = createTestThreads(surface)

  return {
    threads,
    route: threads.routes({
      liveWorkers: () => {
        return [IDLE_WORKER]
      },
      workers
    })(WORKER_THREAD)
  }
}

describe('the status line of a worker thread', () => {
  it('shows the reading status when an allowed starter writes to a worker between turns, before the turn starts', async () => {
    const { calls, surface } = recordSurface()
    const recorded = recordWorkers()
    await using slackChat = openSlackChat()
    const thread = slackChat.chat.thread(WORKER_THREAD)
    const { route } = replyRoute(surface, {
      ...recorded.workers,
      messageWorker: async ({ message }) => {
        calls.push(`message: ${message}`)
      }
    })

    await route?.reply({
      thread,
      user: COLLEAGUE,
      text: 'Push it to main.',
      inputId: `chat:${WORKER_THREAD}:1.0005`
    })
    await route?.reply({
      thread,
      user: STARTER,
      text: 'Go on.',
      inputId: `chat:${WORKER_THREAD}:1.0006`
    })

    expect(calls).toStrictEqual([
      threadStatus('active'),
      threadLine('Reading your message.'),
      'message: Go on.'
    ])
  })

  it('puts the worker status back when the message does not reach the worker', async () => {
    const { calls, surface } = recordSurface()
    await using slackChat = openSlackChat()
    const { route } = replyRoute(surface, {
      ...recordWorkers().workers,
      messageWorker: async () => {
        throw new Error('The host refused the input.')
      }
    })

    await expect(
      route?.reply({
        thread: slackChat.chat.thread(WORKER_THREAD),
        user: STARTER,
        text: 'Go on.',
        inputId: `chat:${WORKER_THREAD}:1.0006`
      })
    ).rejects.toThrow('The host refused the input.')

    expect(calls).toStrictEqual([
      threadStatus('active'),
      threadLine('Reading your message.'),
      CLEARED_LINE,
      threadStatus('active')
    ])
  })

  it('clears the reading status when the turn starts, then follows the turn', async () => {
    const { calls, surface } = recordSurface()
    await using slackChat = openSlackChat()
    const { threads, route } = replyRoute(surface, recordWorkers().workers)

    await route?.reply({
      thread: slackChat.chat.thread(WORKER_THREAD),
      user: STARTER,
      text: 'Go on.',
      inputId: `chat:${WORKER_THREAD}:1.0006`
    })
    await threads.follow({ type: 'status', worker: STARTED_WORKER })
    await threads.follow({ type: 'status', worker: IDLE_WORKER })

    expect(calls).toStrictEqual([
      threadStatus('active'),
      threadLine('Reading your message.'),
      CLEARED_LINE,
      threadStatus('processing'),
      threadStatus('active')
    ])
  })

  it('shows the setup status while the sandbox gets ready, holds the processing status until then, and renews the line each minute', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const setupReached = Promise.withResolvers<null>()
    const setupReleased = Promise.withResolvers<null>()
    const { calls, surface } = recordSurface()
    const watched = watchSurface(surface)
    await using worker = await openWorkerInItsThread(
      watched.surface,
      sandboxSetupUntil(setupReleased.promise, () => {
        setupReached.resolve(null)
      }),
      [{ text: 'Reading.' }]
    )
    calls.length = 0

    const turn = worker.session.send('Do the task TASK-7.')
    await setupReached.promise
    await watched.lineShown
    await worker.threads.follow({ type: 'status', worker: STARTED_WORKER })
    vi.advanceTimersByTime(STATUS_LINE_RENEWAL_MS)
    setupReleased.resolve(null)
    await turn
    await watched.processingShown

    expect(statusCalls(calls)).toStrictEqual([
      threadStatus('active'),
      SETUP_LINE,
      SETUP_LINE,
      CLEARED_LINE,
      threadStatus('processing')
    ])
  })

  it('shows the setup status after a processing status still on its way when the setup starts', async () => {
    const setupReached = Promise.withResolvers<null>()
    const setupReleased = Promise.withResolvers<null>()
    const { calls, surface } = recordSurface()
    const delayed = delayStatus(surface, 'processing')
    const watched = watchSurface(delayed.surface)
    await using worker = await openWorkerInItsThread(
      watched.surface,
      sandboxSetupUntil(setupReleased.promise, () => {
        setupReached.resolve(null)
      }),
      [{ text: 'Reading.' }]
    )
    calls.length = 0
    delayed.arm()

    const runningFollowed = worker.threads.follow({
      type: 'status',
      worker: STARTED_WORKER
    })
    await delayed.reached
    const turn = worker.session.send('Do the task TASK-7.')
    await setupReached.promise
    await sleep(SETUP_EVENT_SETTLE_MS)
    delayed.release()
    await runningFollowed
    await watched.lineShown
    setupReleased.resolve(null)
    await turn

    const setupShownAfterProcessing = [
      threadStatus('processing'),
      threadStatus('active'),
      SETUP_LINE
    ]

    expect(
      statusCalls(calls).slice(0, setupShownAfterProcessing.length)
    ).toStrictEqual(setupShownAfterProcessing)
  })

  it('ends a turn that fails while its sandbox gets ready with no status line and no processing status', async () => {
    const { calls, surface } = recordSurface()
    const watched = watchSurface(surface)
    const turnEnded = Promise.withResolvers<null>()
    const endsTheTurnFirst: ChatSurface = {
      ...watched.surface,
      setStatusLine: async (threadId, line, identity) => {
        await watched.surface.setStatusLine(threadId, line, identity)
        await turnEnded.promise
      }
    }
    await using worker = await openWorkerInItsThread(
      endsTheTurnFirst,
      failingSandboxSetup,
      []
    )
    calls.length = 0

    const turn = Promise.resolve(worker.session.send('Do the task TASK-7.'))
    await watched.lineShown
    const turnEndFollowed = worker.threads.follow({
      type: 'status',
      worker: IDLE_WORKER
    })
    turnEnded.resolve(null)
    await turnEndFollowed
    await turn.catch(() => {
      return null
    })
    await worker.session.close()

    expect(statusCalls(calls)).toStrictEqual([
      threadStatus('active'),
      SETUP_LINE,
      CLEARED_LINE,
      threadStatus('active')
    ])
  })
})
