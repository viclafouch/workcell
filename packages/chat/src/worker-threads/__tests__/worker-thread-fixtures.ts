import type { ActionsElement } from 'chat'
import { z } from 'zod'
import {
  defineInterrupt,
  toolDefinition,
  type ChatMiddleware
} from '@tanstack/ai'
import {
  defineHarness,
  definePlugin,
  type HarnessPlugin,
  type PendingWait
} from '@tanstack/ai-harness'
import { permissions, question, todos } from '@tanstack/ai-harness/plugins'
import { memoryPersistence } from '@tanstack/ai-persistence'
import {
  fakeText,
  type FakeResponse,
  type FakeResponseStep,
  type FakeTextOptions
} from '@tanstack/ai/testing'
import {
  WORKER_DURABILITY,
  workerMetadataSchema,
  type LiveWorker,
  type MessageWorkerParams,
  type StopWorkerParams,
  type WorkerApproval,
  type WorkerMetadata
} from '@workcell/core'
import { createAgentHost, SILENT_HOST_LOGGER } from '@workcell/core/testing'
import { SILENT_CHAT_LOGGER } from '#/__tests__/test-doubles.ts'
import type {
  ChatEditParams,
  ChatMessage,
  ChatPost,
  ChatSurface,
  SessionStatus
} from '#/connection/chat-surface.ts'
import type { WorkerThreadLink } from '#/worker-threads/worker-thread-cards.ts'
import { createWorkerThreads } from '#/worker-threads/worker-threads.ts'

const WORKER_CHANNEL = 'slack:C_WORKERS'

export const WORKER_THREAD = `${WORKER_CHANNEL}:1.0001`

const TEST_WORKERS = [
  {
    name: 'Alpha',
    title: 'Alpha',
    iconUrl: 'https://images.example.com/alpha.png'
  },
  {
    name: 'Bravo',
    title: 'Release worker Bravo',
    iconUrl: 'https://images.example.com/bravo.jpg'
  }
]

export const ALPHA = {
  name: 'Alpha',
  iconUrl: 'https://images.example.com/alpha.png'
}

export const STARTER = 'U_STARTER'

export const COLLEAGUE = 'U_COLLEAGUE'

export const STARTED_WORKER: LiveWorker = {
  threadId: 'worker-1',
  updatedAt: 0,
  name: 'Alpha',
  task: 'Do the task TASK-7.',
  subject: 'TASK-7',
  repository: 'acme/app',
  liveStatus: 'running',
  chatThreadId: WORKER_THREAD
}

export const QUESTION_TEXT = [
  'Open the pull request as a draft or ready?',
  '1. Draft',
  '2. Ready'
].join('\n')

export const STARTING_LINE = 'I take TASK-7. Setting up.'

export const ASK_DRAFT_OR_READY: FakeResponse = {
  toolCalls: [
    {
      name: 'question',
      input: {
        questions: [
          {
            question: 'Open the pull request as a draft or ready?',
            options: [{ label: 'Draft' }, { label: 'Ready' }]
          }
        ]
      }
    }
  ]
}

const DEPLOY_PREVIEW = 'deploy {"target":"preview"}'

export const APPROVAL_TEXT = `May I run this?\n\`\`\`\n${DEPLOY_PREVIEW}\n\`\`\``

export const ASK_TO_DEPLOY: FakeResponse = {
  toolCalls: [{ name: 'deploy', input: { target: 'preview' } }]
}

export const ASK_TO_RUN: FakeResponse = {
  toolCalls: [{ name: 'run', input: { command: 'npm view react version' } }]
}

const run = toolDefinition({
  name: 'run',
  description: 'Run a command',
  inputSchema: z.object({ command: z.string() })
}).server(async ({ command }) => {
  return `Ran ${command}.`
})

const deploy = toolDefinition({
  name: 'deploy',
  description: 'Deploy a preview',
  inputSchema: z.object({ target: z.string() })
}).server(async ({ target }) => {
  return `Deployed ${target}.`
})

export const GO_ON_TEXT =
  'Alpha used its budget for this task: $5.00 of $5.00, in 40 model calls. Answer to go on with $5.00 more, or to stop here.'

const goOnStop = defineInterrupt({
  id: 'test/go-on',
  responseSchema: z.string()
})

const stopBeforeEachModelCall: HarnessPlugin = definePlugin({
  name: 'test/stop-before-each-model-call',
  setup: () => {
    const stop: ChatMiddleware<unknown, typeof goOnStop> = {
      name: 'test/stop-before-each-model-call',
      onInterruptBoundary: ({ phase, runId, iteration }) => {
        return phase === 'beforeModel'
          ? {
              interrupts: [
                goOnStop.interrupt({
                  key: `${runId}:${iteration}`,
                  reason: 'budget',
                  message: GO_ON_TEXT
                })
              ]
            }
          : undefined
      }
    }

    return { middleware: [stop] }
  }
})

export const TASK_7_METADATA = {
  name: 'Alpha',
  task: 'Do the task TASK-7.',
  subject: 'TASK-7',
  repository: 'acme/app'
}

export function todoWrite(
  steps: [string, 'pending' | 'in_progress' | 'done'][]
): FakeResponse {
  return {
    toolCalls: [
      {
        name: 'todo_write',
        input: {
          todos: steps.map(([text, status]) => {
            return { text, status }
          })
        }
      }
    ]
  }
}

export const TASK_LINK = {
  type: 'link-button',
  id: 'worker_link_task',
  label: 'Task',
  url: 'https://tracker.example.com/TASK-7'
}

export const STOP_BUTTON = {
  type: 'button',
  id: 'worker_stop',
  label: 'Stop',
  style: 'danger',
  visibleTo: [STARTER]
}

function testLinks({
  subject,
  repository,
  branch
}: WorkerMetadata): WorkerThreadLink[] {
  const task =
    subject === undefined
      ? []
      : [
          {
            id: 'task',
            label: 'Task',
            url: `https://tracker.example.com/${subject}`
          }
        ]
  const change =
    branch === undefined
      ? []
      : [
          {
            id: 'change',
            label: 'Change',
            url: `https://code.example.com/${repository}/changes/${branch}`
          }
        ]

  return [...task, ...change]
}

function textOf(message: ChatMessage) {
  return 'markdown' in message ? message.markdown : (message.fallbackText ?? '')
}

export function postText({ message }: ChatPost) {
  return textOf(message)
}

export function actionsOf(message: ChatMessage | undefined) {
  if (message === undefined || !('card' in message)) {
    return []
  }

  return message.card.children
    .filter((child): child is ActionsElement => {
      return child.type === 'actions'
    })
    .flatMap(({ children }) => {
      return children
    })
}

export function threadPost(text: string, thread = WORKER_THREAD) {
  return `Alpha ${ALPHA.iconUrl} post ${thread}: ${text}`
}

export function threadStatus(status: string, name = 'Alpha') {
  return `${name} ${ALPHA.iconUrl} status ${WORKER_THREAD} ${status}`
}

export function threadLine(line: string) {
  return `Alpha ${ALPHA.iconUrl} line ${WORKER_THREAD}: ${line}`
}

export const CLEARED_LINE = `the app app picture line ${WORKER_THREAD}: `

export function rootPost(line: string) {
  return threadPost(`Hi, Alpha here.\n${line}`, 'root')
}

function describePost({ target, identity, message }: ChatPost) {
  const place = 'channelId' in target ? 'root' : target.threadId

  return `${identity?.name ?? 'the app'} ${identity?.iconUrl ?? 'app picture'} post ${place}: ${textOf(message)}`
}

export function recordSurface() {
  const calls: string[] = []
  const posts: ChatPost[] = []
  const edits: ChatEditParams[] = []
  const surface: ChatSurface = {
    post: async (post) => {
      posts.push(post)
      calls.push(describePost(post))
      const messageId = `${posts.length}.0001`
      const { target } = post

      return {
        threadId:
          'channelId' in target
            ? `${target.channelId}:${messageId}`
            : target.threadId,
        messageId
      }
    },
    edit: async (edit) => {
      edits.push(edit)
      calls.push(`edit ${edit.messageId}: ${textOf(edit.message)}`)
    },
    linked: (markdown) => {
      return markdown
    },
    setStatus: async (threadId, status, identity) => {
      calls.push(
        `${identity?.name ?? 'the app'} ${identity?.iconUrl ?? 'app picture'} status ${threadId} ${status}`
      )
    },
    setStatusLine: async (threadId, line, identity) => {
      calls.push(
        `${identity?.name ?? 'the app'} ${identity?.iconUrl ?? 'app picture'} line ${threadId}: ${line}`
      )
    },
    subscribe: async (threadId) => {
      calls.push(`subscribe ${threadId}`)
    },
    mention: (_threadId, userId) => {
      return `<@${userId}>`
    },
    channelOf: (threadId) => {
      return threadId.split(':').slice(0, 2).join(':')
    }
  }

  return { calls, posts, edits, surface }
}

export function watchSurface(surface: ChatSurface) {
  const lineShown = Promise.withResolvers<null>()
  const processingShown = Promise.withResolvers<null>()
  const watched: ChatSurface = {
    ...surface,
    setStatusLine: async (threadId, line, identity) => {
      await surface.setStatusLine(threadId, line, identity)
      lineShown.resolve(null)
    },
    setStatus: async (threadId, status, identity) => {
      await surface.setStatus(threadId, status, identity)

      if (status === 'processing') {
        processingShown.resolve(null)
      }
    }
  }

  return {
    surface: watched,
    lineShown: lineShown.promise,
    processingShown: processingShown.promise
  }
}

export function delayStatus(surface: ChatSurface, delayed: SessionStatus) {
  const reached = Promise.withResolvers<null>()
  const released = Promise.withResolvers<null>()
  const delay = { isArmed: false }
  const delaying: ChatSurface = {
    ...surface,
    setStatus: async (threadId, status, identity) => {
      if (delay.isArmed && status === delayed) {
        delay.isArmed = false
        reached.resolve(null)
        await released.promise
      }

      await surface.setStatus(threadId, status, identity)
    }
  }

  return {
    surface: delaying,
    arm: () => {
      delay.isArmed = true
    },
    reached: reached.promise,
    release: () => {
      released.resolve(null)
    }
  }
}

export function statusCalls(calls: readonly string[]) {
  return calls.filter((call) => {
    return !call.includes(' post ') && !call.startsWith('edit ')
  })
}

export function posted(calls: readonly string[]) {
  return calls.filter((call) => {
    return call.includes(' post ')
  })
}

export function createTestThreads(surface: ChatSurface) {
  return createWorkerThreads({
    surface,
    channelId: WORKER_CHANNEL,
    workers: TEST_WORKERS,
    allowedStarters: [STARTER],
    logger: SILENT_CHAT_LOGGER,
    links: testLinks
  })
}

type WorkerSessionOpenerParams = {
  plugins?: readonly HarnessPlugin[]
  modelOptions?: FakeTextOptions<string>
}

export function workerSessionOpener({
  plugins = [],
  modelOptions = {}
}: WorkerSessionOpenerParams = {}) {
  return async (
    persistence: ReturnType<typeof memoryPersistence>,
    surface: ChatSurface,
    responses: FakeResponseStep[]
  ) => {
    const model = fakeText(modelOptions)
    model.setResponses(responses)
    const threads = createTestThreads(surface)
    const harness = defineHarness({
      name: 'test/worker-threads',
      adapter: model,
      tools: [deploy, run],
      interrupts: [goOnStop],
      metadataSchema: workerMetadataSchema,
      durability: WORKER_DURABILITY,
      plugins: () => {
        return [
          ...plugins,
          todos(),
          question(),
          permissions({
            rules: [
              { tool: 'deploy', decision: 'ask' },
              { tool: 'run', decision: 'ask' }
            ]
          }),
          threads.plugin
        ]
      }
    })
    const host = createAgentHost({ persistence, logger: SILENT_HOST_LOGGER })
    const session = await host.open(harness, {
      threadId: STARTED_WORKER.threadId,
      user: { id: STARTER }
    })

    return {
      session,
      host,
      harness,
      threads,
      [Symbol.asyncDispose]: async () => {
        await session.close()
        await host.close()
      }
    }
  }
}

export const openWorkerSession = workerSessionOpener()

export const openLimitedWorkerSession = workerSessionOpener({
  plugins: [stopBeforeEachModelCall]
})

export const openSlowWorkerSession = workerSessionOpener({
  modelOptions: { tokensPerSecond: 50 }
})

export function firstWaitId(waits: readonly PendingWait[]) {
  const [first] = waits

  if (first === undefined) {
    throw new Error('The worker waits for no person.')
  }

  return first.waitId
}

export function recordWorkers() {
  const messages: MessageWorkerParams[] = []
  const approvals: WorkerApproval[] = []
  const stops: string[] = []
  let isRunning = true

  return {
    messages,
    approvals,
    stops,
    sleep: () => {
      isRunning = false
    },
    workers: {
      messageWorker: async (message: MessageWorkerParams) => {
        messages.push(message)
      },
      answerApproval: async (approval: WorkerApproval) => {
        approvals.push(approval)

        return approvals.length === 1
      },
      stopWorker: async ({ threadId, user }: StopWorkerParams) => {
        stops.push(`${user.id} ${threadId}`)

        return isRunning
      }
    }
  }
}
