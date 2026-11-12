import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'
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
import type { SlackEditParams, SlackPostParams } from './channel-poster.ts'
import type { SlackWeb } from './slack-web.ts'
import { SILENT_SLACK_LOGGER } from './test-doubles.ts'
import type { WorkerThreadLink } from './worker-thread-blocks.ts'
import { createWorkerThreads } from './worker-threads.ts'

export const WORKER_CHANNEL = 'C_WORKERS'

const TEST_WORKERS = [
  {
    name: 'Alpha',
    title: 'Alpha',
    icon: { url: 'https://images.example.com/alpha.png' }
  },
  {
    name: 'Bravo',
    title: 'Release worker Bravo',
    icon: { url: 'https://images.example.com/bravo.jpg' }
  }
]

export const STARTER = 'U_STARTER'

export const COLLEAGUE = 'U_COLLEAGUE'

export const VOICE = 'Answer in one short line.'

export const WORKER_THREAD = { channel: WORKER_CHANNEL, threadTs: '1.0001' }

export const STARTED_WORKER: LiveWorker = {
  threadId: 'worker-1',
  updatedAt: 0,
  name: 'Alpha',
  task: 'Do the task TASK-7.',
  subject: 'TASK-7',
  repository: 'acme/app',
  liveStatus: 'running',
  slackChannel: WORKER_CHANNEL,
  slackThreadTs: WORKER_THREAD.threadTs
}

export const QUESTION_TEXT = [
  'Open the pull request as a draft or ready?',
  '1. Draft',
  '2. Ready'
].join('\n')

export const OPENING_LINE = 'I take TASK-7'

export const OPENING: FakeResponse = { text: OPENING_LINE }

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

export const DEPLOY_PREVIEW = 'deploy {"target":"preview"}'

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

function describePost({ threadTs, identity, ...content }: SlackPostParams) {
  const body =
    'markdown' in content
      ? content.markdown
      : `${content.text} ${JSON.stringify(content.blocks)}`

  return `${identity?.username ?? 'the app'} ${identity?.icon?.url ?? 'app picture'} post ${threadTs ?? 'root'}: ${body}`
}

export const TASK_BUTTON = {
  type: 'button',
  action_id: 'worker_link_task',
  text: { type: 'plain_text', text: 'Task' },
  url: 'https://tracker.example.com/TASK-7'
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

export async function voiceFile() {
  const folder = await mkdtemp(join(tmpdir(), 'slack-voice-'))
  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true })
  })
  const file = join(folder, 'VOICE.md')
  await writeFile(file, VOICE)

  return file
}

export function openingBlocks(text: string, buttons: readonly object[]) {
  return [
    { type: 'section', text: { type: 'mrkdwn', text } },
    { type: 'actions', elements: buttons }
  ]
}

export function rootPost(line: string) {
  const text = `Hi, Alpha here.\n${line}`

  return `Alpha https://images.example.com/alpha.png post root: ${text} ${JSON.stringify(openingBlocks(text, [TASK_BUTTON]))}`
}

function describeEdit({ ts, ...content }: SlackEditParams) {
  return `edit ${ts}: ${'text' in content ? content.text : content.markdown}`
}

export function recordSlack() {
  const calls: string[] = []
  const posts: SlackPostParams[] = []
  const edits: SlackEditParams[] = []
  const web: SlackWeb = {
    post: async (post) => {
      posts.push(post)
      calls.push(describePost(post))

      return `${posts.length}.0001`
    },
    edit: async (edit) => {
      edits.push(edit)
      calls.push(describeEdit(edit))
    },
    setStatus: async ({ threadTs, status, identity, title, initiator }) => {
      calls.push(
        [identity?.username, 'status', threadTs, status, title, initiator]
          .filter(Boolean)
          .join(' ')
      )
    },
    rename: () => {
      throw new Error('A worker thread keeps its greeting as its title.')
    },
    stream: () => {
      throw new Error('A worker thread streams nothing.')
    }
  }

  return { calls, posts, edits, web }
}

export function createTestThreads(web: SlackWeb, voice?: string) {
  return createWorkerThreads({
    web,
    channel: WORKER_CHANNEL,
    workers: TEST_WORKERS,
    allowedStarters: [STARTER],
    logger: SILENT_SLACK_LOGGER,
    links: testLinks,
    voiceFile: voice
  })
}

type WorkerSessionOpenerParams = {
  plugins?: readonly HarnessPlugin[]
  modelOptions?: FakeTextOptions<string>
  voice?: string
}

export function workerSessionOpener({
  plugins = [],
  modelOptions = {},
  voice
}: WorkerSessionOpenerParams = {}) {
  return async (
    persistence: ReturnType<typeof memoryPersistence>,
    web: SlackWeb,
    responses: FakeResponseStep[]
  ) => {
    const model = fakeText(modelOptions)
    model.setResponses(responses)
    const threads = createTestThreads(web, voice)
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
