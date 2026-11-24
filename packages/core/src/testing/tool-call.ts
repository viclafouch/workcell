import { z } from 'zod'
import type { AnyTextAdapter, TextOptions } from '@tanstack/ai'
import {
  createHarnessHost,
  defineCommand,
  definePlugin,
  PermissionCallCapability,
  type HarnessHost,
  type HarnessPlugin,
  type HarnessUser,
  type PermissionMode
} from '@tanstack/ai-harness'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { sandboxWorkspaceBackend } from '@tanstack/ai-sandbox/harness'
import type { SkillSource } from '@tanstack/ai-skills'
import { fakeText } from '@tanstack/ai/testing'
import type { FeedbackOptions } from '#/feedback/feedback.ts'
import { readOnlyCredentials } from '#/host/read-only-credentials.ts'
import { WORKSPACE_ROOT } from '#/sandbox/sandbox-facts.ts'
import type { WorkerMetadata } from '#/session/metadata.ts'
import { defineWorkerHarness } from '#/workers/harness.ts'
import type { WorkerLifecycle } from '#/workers/lifecycle.ts'
import {
  createHostFreeLifecycle,
  type createHostFreeSandbox
} from './host-free-sandbox.ts'
import {
  FREE_MODEL_PRICING,
  ROOMY_LIMITS,
  SILENT_HOST_LOGGER,
  TEST_STARTER
} from './test-doubles.ts'

type HostFreeSandbox = Awaited<ReturnType<typeof createHostFreeSandbox>>

export type ToolCall = { name: string; input: Record<string, unknown> }

type DefineTestWorkerParams = {
  host: HarnessHost
  model: AnyTextAdapter
  hostFree: HostFreeSandbox
  lifecycle?: WorkerLifecycle
  redactedSecretNames?: readonly string[]
  plugins?: readonly HarnessPlugin[]
  skillSources?: readonly SkillSource[]
  feedback?: FeedbackOptions
}

type ToolCallOptions = {
  hostFree: HostFreeSandbox
  toolCall: ToolCall
  mode?: PermissionMode
  secrets?: Readonly<Record<string, string>>
  metadata?: WorkerMetadata
  plugins?: readonly HarnessPlugin[]
  skillSources?: readonly SkillSource[]
  user?: HarnessUser
}

const toolListSchema = z.array(z.object({ name: z.string() }))

const DECIDE_COMMAND = 'decide-tool-call'

const callDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('allow') }),
  z.object({ decision: z.literal('ask') }),
  z.object({ decision: z.literal('deny'), error: z.string() })
])

const callDecision = definePlugin({
  name: 'workcell/test-call-decision',
  optionalRequires: [PermissionCallCapability],
  setup: (setupContext) => {
    return {
      commands: {
        [DECIDE_COMMAND]: defineCommand({
          description:
            'Tell what permissions() decides for a tool call, and run nothing',
          input: z.object({
            tool: z.string(),
            args: z.record(z.string(), z.unknown())
          }),
          run: async (call) => {
            const decide = setupContext.getOptional(PermissionCallCapability)

            if (decide === undefined) {
              throw new Error('The test worker has no permissions() plugin.')
            }

            const checked = await decide(call)

            return checked.decision === 'deny'
              ? { decision: 'deny', error: checked.error }
              : { decision: checked.decision }
          }
        })
      }
    }
  }
})

function toolNames(request: TextOptions) {
  return toolListSchema.parse(request.tools ?? []).map(({ name }) => {
    return name
  })
}

export function defineTestWorker({
  host,
  model,
  hostFree,
  lifecycle = createHostFreeLifecycle(host, hostFree),
  redactedSecretNames = [],
  plugins = [],
  skillSources = [],
  feedback
}: DefineTestWorkerParams) {
  return defineWorkerHarness({
    adapter: model,
    compactionAdapter: model,
    workspace: {
      bind: async () => {
        return {
          ...sandboxWorkspaceBackend(hostFree.sandbox),
          root: WORKSPACE_ROOT
        }
      }
    },
    lifecycle: lifecycle.plugin,
    skills: { dirs: [], sources: skillSources },
    redactedSecretNames,
    pricing: FREE_MODEL_PRICING,
    defaultLimits: ROOMY_LIMITS,
    plugins,
    feedback
  })
}

export async function runWorkerToolCall({
  hostFree,
  toolCall,
  mode = 'acceptEdits',
  secrets = {},
  metadata,
  plugins,
  skillSources,
  user = TEST_STARTER
}: ToolCallOptions) {
  const modelTools: string[] = []
  const systemPrompts: string[] = []
  const modelMessages: string[] = []
  const model = fakeText()
  model.setResponses([
    ({ request }) => {
      modelTools.push(...toolNames(request))
      systemPrompts.push(JSON.stringify(request.systemPrompts))

      return { toolCalls: [toolCall] }
    },
    ({ request }) => {
      modelMessages.push(JSON.stringify(request.messages))

      return { text: 'Done.' }
    }
  ])
  const host = createHarnessHost({
    persistence: memoryPersistence(),
    logger: SILENT_HOST_LOGGER,
    credentials: readOnlyCredentials(secrets)
  })
  const worker = defineTestWorker({
    host,
    model,
    hostFree,
    redactedSecretNames: Object.keys(secrets),
    plugins,
    skillSources
  })
  const session = await host.open(worker, {
    threadId: 'worker-tool-call',
    user
  })

  if (metadata !== undefined) {
    await session.updateIndexEntry({ metadata })
  }

  const results: string[] = []
  const stopListening = session.onEvent('TOOL_CALL_RESULT', ({ event }) => {
    results.push(
      typeof event.content === 'string'
        ? event.content
        : JSON.stringify(event.content)
    )
  })

  await session.setPluginSetting({ key: 'mode', value: mode })
  await session.send(`Call ${toolCall.name}.`)
  stopListening()
  const { pendingWaits } = session.snapshot()
  await host.close()

  return {
    result: results.join('\n'),
    asked: pendingWaits.length > 0,
    modelTools,
    systemPrompt: systemPrompts.join('\n'),
    modelContext: modelMessages.join('\n')
  }
}

export async function decideWorkerToolCall({
  hostFree,
  toolCall,
  mode = 'acceptEdits',
  plugins = []
}: Omit<ToolCallOptions, 'secrets' | 'metadata'>) {
  const host = createHarnessHost({
    persistence: memoryPersistence(),
    logger: SILENT_HOST_LOGGER
  })
  const worker = defineTestWorker({
    host,
    model: fakeText(),
    hostFree,
    plugins: [...plugins, callDecision]
  })

  try {
    const session = await host.open(worker, {
      threadId: 'worker-tool-call-decision',
      user: TEST_STARTER
    })
    await session.setPluginSetting({ key: 'mode', value: mode })

    return callDecisionSchema.parse(
      await session.runCommand({
        name: DECIDE_COMMAND,
        input: { tool: toolCall.name, args: toolCall.input }
      })
    )
  } finally {
    await host.close()
  }
}
