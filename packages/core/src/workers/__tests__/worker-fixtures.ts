import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan
} from '@opentelemetry/sdk-trace'
import {
  EventType,
  type ModelMessage,
  type StreamChunk,
  type SystemPrompt,
  type TextOptions,
  type TokenUsage
} from '@tanstack/ai'
import {
  definePlugin,
  PermissionRules,
  type PendingWait
} from '@tanstack/ai-harness'
import {
  FakeTextAdapter,
  type FakeResponse,
  type FakeResponseStep
} from '@tanstack/ai/testing'
import { BUDGET_END_EVENT } from '#/budget/budget.ts'
import type { BudgetLimits } from '#/budget/limits.ts'
import { createModelPricing } from '#/budget/pricing.ts'
import { TEST_STARTER } from '#/testing/test-doubles.ts'
import type { WorkerChange } from '#/workers/live-workers.ts'
import type { WorkerTask } from '#/workers/workers.ts'

function runGit(args: string[]) {
  execFileSync('git', args)
}

export const loggedLines: string[] = []

function recordingLogger(bindings: Record<string, unknown>) {
  const recordLine = (details: Record<string, unknown>, message: string) => {
    loggedLines.push(JSON.stringify([{ ...bindings, ...details }, message]))
  }

  return {
    debug: recordLine,
    info: recordLine,
    warn: recordLine,
    error: recordLine
  }
}

export const RECORDING_WORKER_LOGGER = {
  child: recordingLogger
}

export const SANDBOX_SECRETS = {
  GITHUB_TOKEN: 'github_pat_worker_secret_value',
  NPM_TOKEN: 'npm_worker_secret_value',
  ASSETS_CDN_TOKEN: 'assets_cdn_worker_secret_value'
}

export const REPOSITORY = 'acme/app'

export const SECOND_REPOSITORY = 'acme/tooling'

export const TICKET_START: WorkerTask = {
  starter: TEST_STARTER,
  repository: REPOSITORY,
  task: 'Do the ticket TASK-7.',
  subject: 'TASK-7',
  inputId: 'TASK-7'
}

export const HOST_GIT_IDENTITY = {
  name: 'Host Developer',
  email: 'host@example.com',
  coAuthorEmail: 'noreply@example.com'
}

export const COMMIT_AND_SHOW_WHO =
  'git commit --quiet --allow-empty -m "Show who commits" && git log -1 --format="%an <%ae>, %cn <%ce>"'

export const HOST_COMMITTER =
  'Host Developer <host@example.com>, Host Developer <host@example.com>'

export const ENTRY_SKILL = 'start-ticket'

export const TEST_NAMES = ['Alpha']

export const TWO_NAMES = ['Alpha', 'Bravo']

export const FOUR_NAMES = ['Alpha', 'Bravo', 'Echo', 'Delta']

export const COLLEAGUE = { id: 'colleague' }

export const ORCHESTRATOR_NAME = 'Orchestrator'

export const MIGRATE_COMMAND = 'pnpm db:migrate'

export const COLLEAGUE_THREAD_PREFIX = 'slack/CTEST/'

export const SHORT_IDLE_MS = 500

export const TOKENS_PER_PRICE_UNIT = 1_000_000

export const FAKE_MODEL_PRICING = createModelPricing({
  'fake-model': { input: 1, output: 1 }
})

export const SPENT_AFTER_ONE_CALL: BudgetLimits = {
  maxCostUsd: 0.000_01
}

export const SPENT_AFTER_TWO_CALLS: BudgetLimits = {
  maxCostUsd: 0.000_2
}

export const COMPACTION_MODEL = 'fake-compaction'

export const COMPACTION_PRICING = createModelPricing({
  'fake-model': { input: 0, output: 0 },
  [COMPACTION_MODEL]: { input: 1, output: 1 }
})

export const SPENT_AFTER_A_LONG_SUMMARY: BudgetLimits = {
  maxCostUsd: 0.1
}

export const LOGIN_TASK =
  'Do the ticket TASK-7: keep the login form on one line.'

export const LONG_READ_LINE = 'A line of a long file that the agent read.'

const LONG_READ_LINES = 16_000

export const LONG_READ = `${LONG_READ_LINE}\n`.repeat(LONG_READ_LINES)

const BILLED_FAILURE_USAGE: TokenUsage = {
  promptTokens: 40,
  completionTokens: 10,
  totalTokens: 50
}

export const PROVIDER_COST_USD = 0.25

export class ProviderCostFake extends FakeTextAdapter<string> {
  override async *chatStream(options: TextOptions) {
    for await (const chunk of super.chatStream(options)) {
      yield chunk.type === EventType.RUN_FINISHED &&
      chunk.usage !== undefined &&
      !Array.isArray(chunk.usage)
        ? { ...chunk, usage: { ...chunk.usage, cost: PROVIDER_COST_USD } }
        : chunk
    }
  }
}

export class BilledFailureFake extends FakeTextAdapter<string> {
  override async *chatStream(options: TextOptions) {
    for await (const chunk of super.chatStream(options)) {
      yield chunk.type === EventType.RUN_ERROR
        ? { ...chunk, usage: BILLED_FAILURE_USAGE }
        : chunk
    }
  }
}

export const WORK_ON_A_BRANCH = [
  'git switch --quiet -c task-9-wake-up',
  'echo one > committed.md',
  'git add committed.md',
  'git commit --quiet -m "Add the committed file"',
  'echo two > uncommitted.md',
  'rm README.md'
].join(' && ')

export const CHECK_THE_WORK =
  'git status --short --branch && git log --format=%s -1 && cat committed.md uncommitted.md'

export const RESTORED_WORK = String.raw`## task-9-wake-up\n D README.md\n?? uncommitted.md\nAdd the committed file\none\ntwo`

export function bash(command: string): FakeResponse {
  return { toolCalls: [{ name: 'bash', input: { command } }] }
}

export function finishTask(report = 'Merged.'): FakeResponse {
  return { toolCalls: [{ name: 'finish_task', input: { report } }] }
}

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

export const ASK_CLOSE_OR_RETARGET: FakeResponse = {
  toolCalls: [
    {
      name: 'question',
      input: {
        questions: [
          {
            question: 'dev already does it: close the ticket, or retarget it?',
            options: [{ label: 'Close' }, { label: 'Retarget' }]
          }
        ]
      }
    }
  ]
}

export function systemPromptTexts(prompts: readonly SystemPrompt[] = []) {
  return prompts.map((prompt) => {
    return typeof prompt === 'string' ? prompt : prompt.content
  })
}

export function toolResults(transcript: ModelMessage[]) {
  return transcript
    .filter(({ role }) => {
      return role === 'tool'
    })
    .map(({ content }) => {
      return JSON.stringify(content)
    })
    .join('\n')
}

export function recordSpans() {
  const exporter = new InMemorySpanExporter()
  const provider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter })]
  })

  return {
    observability: { tracerProvider: provider },
    finishedSpans: () => {
      return exporter.getFinishedSpans()
    }
  }
}

export function spanNamed(spans: ReadableSpan[], name: string) {
  const span = spans.find((candidate) => {
    return candidate.name === name
  })

  if (span === undefined) {
    throw new Error(`No span is named ${name}.`)
  }

  return span
}

export function spanCost(span: ReadableSpan) {
  return span.attributes['gen_ai.usage.cost']
}

export function spanTokens(span: ReadableSpan) {
  return (
    Number(span.attributes['gen_ai.usage.input_tokens']) +
    Number(span.attributes['gen_ai.usage.output_tokens'])
  )
}

export function meetAt(
  callCount: number,
  response: FakeResponse
): FakeResponseStep {
  const everyoneArrived = Promise.withResolvers<null>()
  let arrived = 0

  return async () => {
    arrived += 1

    if (arrived === callCount) {
      everyoneArrived.resolve(null)
    }

    await everyoneArrived.promise

    return response
  }
}

export function holdUntil(released: Promise<null>): FakeResponseStep {
  return async () => {
    await released

    return { text: 'Done.' }
  }
}

export async function createOrigin(readme = 'The repository.\n') {
  const root = await mkdtemp(join(tmpdir(), 'worker-origin-'))
  const work = join(root, 'work')
  const origin = join(root, 'origin.git')
  runGit(['init', '--quiet', '--initial-branch', 'dev', work])
  await writeFile(join(work, 'README.md'), readme)
  runGit(['-C', work, 'add', 'README.md'])
  runGit([
    '-C',
    work,
    '-c',
    'user.name=Origin',
    '-c',
    'user.email=origin@example.com',
    'commit',
    '--quiet',
    '-m',
    'Start the repository'
  ])
  runGit(['clone', '--quiet', '--bare', work, origin])
  runGit([
    '-C',
    origin,
    'config',
    'uploadpack.allowReachableSHA1InWant',
    'true'
  ])

  return {
    url: `file://${origin}`,
    advance: async () => {
      runGit([
        '-C',
        work,
        '-c',
        'user.name=Origin',
        '-c',
        'user.email=origin@example.com',
        'commit',
        '--quiet',
        '--allow-empty',
        '-m',
        'Move dev on'
      ])
      runGit(['-C', work, 'push', '--quiet', origin, 'dev'])
    },
    destroy: async () => {
      await rm(root, { recursive: true, force: true })
    }
  }
}

export const allowGit = definePlugin({
  name: 'test/allow-git',
  setup: () => {
    return {
      contribute: [
        PermissionRules.item({
          tool: 'bash',
          resource: 'git *',
          decision: 'allow',
          kind: 'execute'
        })
      ]
    }
  }
})

export function holdTwoTurns(released: Promise<null>) {
  return Array.from({ length: 2 }, () => {
    return holdUntil(released)
  })
}

export function holdUntilStopped(
  started: PromiseWithResolvers<null>
): FakeResponseStep {
  return async ({ request }) => {
    started.resolve(null)
    const signal = request.request?.signal

    if (signal && !signal.aborted) {
      await once(signal, 'abort')
    }

    return { text: 'Stopped.' }
  }
}

export function firstWaitId(waits: readonly PendingWait[]) {
  const [first] = waits

  if (first === undefined) {
    throw new Error('The worker waits for no person.')
  }

  return first.waitId
}

export function describeChange(change: WorkerChange) {
  return change.type === 'finished'
    ? `finished ${change.worker.name} ${change.worker.report}`
    : change.worker.liveStatus
}

function isOrchestratorCall(request: TextOptions) {
  return JSON.stringify(request.systemPrompts).includes(
    `You are ${ORCHESTRATOR_NAME}.`
  )
}

export function routedResponses(
  orchestrator: FakeResponseStep[],
  worker: FakeResponseStep[] = []
): FakeResponseStep[] {
  const queues = { orchestrator: [...orchestrator], worker: [...worker] }
  const routed: FakeResponseStep = async (call) => {
    const queue = isOrchestratorCall(call.request)
      ? queues.orchestrator
      : queues.worker
    const step = queue.shift()

    if (step === undefined) {
      throw new Error('The test gave this agent no more model answers.')
    }

    return typeof step === 'function' ? step(call) : step
  }

  return Array.from({ length: orchestrator.length + worker.length }, () => {
    return routed
  })
}

export function callTool(name: string, input: Record<string, unknown> = {}) {
  return { toolCalls: [{ name, input }] }
}

export function toolResultsOf(events: readonly StreamChunk[]) {
  return events.flatMap((event) => {
    if (event.type !== EventType.TOOL_CALL_RESULT) {
      return []
    }

    return [
      typeof event.content === 'string'
        ? event.content
        : JSON.stringify(event.content)
    ]
  })
}

export function budgetEndsOf(events: readonly StreamChunk[]) {
  return events.flatMap((event) => {
    return event.type === EventType.CUSTOM && event.name === BUDGET_END_EVENT
      ? [JSON.stringify(event.value)]
      : []
  })
}

export function textOf(events: readonly StreamChunk[]) {
  return events
    .flatMap((event) => {
      return event.type === EventType.TEXT_MESSAGE_CONTENT ? [event.delta] : []
    })
    .join('')
}
