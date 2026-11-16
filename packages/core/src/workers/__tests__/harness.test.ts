import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ModelMessage } from '@tanstack/ai'
import {
  definePlugin,
  PermissionRules,
  type PermissionMode
} from '@tanstack/ai-harness'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { fakeText } from '@tanstack/ai/testing'
import { CUT_OFF_NOTE, TRUNCATED_TOOL_RESULT } from '#/host/agent-durability.ts'
import { createAgentHost } from '#/host/agent-host.ts'
import { createHostFreeSandbox } from '#/testing/host-free-sandbox.ts'
import {
  LONG_HOST_TOOL,
  longHostTool,
  OVERLOADED_MODEL_ERROR,
  SILENT_HOST_LOGGER,
  TEST_STARTER
} from '#/testing/test-doubles.ts'
import {
  defineTestWorker,
  runWorkerToolCall,
  type ToolCall
} from '#/testing/tool-call.ts'

const MODEL_CALLS_WITH_ONE_RETRY = 3

const LAST_TWO_MESSAGES = 2

const SANDBOX_SECRETS = { NPM_TOKEN: 'npm_sandbox_secret_value' }

const RULE_DENIAL = 'A permission rule denies this tool.'
const PLAN_DENIAL = 'This tool is not allowed in plan mode.'

const CORE_DENIED_COMMANDS = [
  'sudo ls',
  'docker ps',
  'git push origin dev',
  'git push origin main',
  'git push origin HEAD:dev',
  'git push origin task-1-fix:refs/heads/main',
  'git push',
  'git push origin',
  'git push --force origin task-1-fix',
  'git push -f origin task-1-fix',
  'git push origin +task-1-fix',
  'git push -uf origin task-1-fix',
  'git push origin HEAD',
  'git push -u origin HEAD',
  'git -C packages/ui push origin dev',
  'git add . && git push origin dev'
]

const allowEverything = definePlugin({
  name: 'test/allow-everything',
  setup: () => {
    return {
      contribute: ['*', 'sudo *', 'docker *', 'git *', 'git push *'].map(
        (resource) => {
          return PermissionRules.item({
            tool: 'bash',
            resource,
            decision: 'allow',
            kind: 'execute'
          })
        }
      )
    }
  }
})

const denyLongHostTool = definePlugin({
  name: 'test/deny-long-host-tool',
  setup: () => {
    return {
      contribute: [
        PermissionRules.item({ tool: LONG_HOST_TOOL, decision: 'deny' })
      ]
    }
  }
})

let hostFree: Awaited<ReturnType<typeof createHostFreeSandbox>>

function runToolCall(toolCall: ToolCall, mode?: PermissionMode) {
  return runWorkerToolCall({
    hostFree,
    toolCall,
    mode,
    secrets: SANDBOX_SECRETS
  })
}

function runBash(command: string, mode?: PermissionMode) {
  return runToolCall({ name: 'bash', input: { command } }, mode)
}

describe('the worker harness', () => {
  beforeAll(async () => {
    hostFree = await createHostFreeSandbox(SANDBOX_SECRETS)
  })

  afterAll(async () => {
    await hostFree.destroy()
  })

  it.each(CORE_DENIED_COMMANDS)('refuses %s', async (command) => {
    const run = await runBash(command)

    expect(run.result).toContain(RULE_DENIAL)
  })

  it.each(CORE_DENIED_COMMANDS)(
    'refuses %s when a plugin allows every command',
    async (command) => {
      const run = await runWorkerToolCall({
        hostFree,
        toolCall: { name: 'bash', input: { command } },
        plugins: [allowEverything]
      })

      expect(run.result).toContain(RULE_DENIAL)
    }
  )

  it.each(CORE_DENIED_COMMANDS)(
    'refuses %s in bypass mode',
    async (command) => {
      const run = await runBash(command, 'bypass')

      expect(run.result).toContain(RULE_DENIAL)
    }
  )

  it('hides from the model a tool that a rule denies, in bypass mode', async () => {
    const run = await runWorkerToolCall({
      hostFree,
      toolCall: { name: 'bash', input: { command: 'echo ready' } },
      mode: 'bypass',
      plugins: [longHostTool, denyLongHostTool]
    })

    expect(run.modelTools).toContain('bash')
    expect(run.modelTools).not.toContain(LONG_HOST_TOOL)
  })

  it('runs a command with shell syntax in bypass mode, with no question', async () => {
    const run = await runBash(
      `printf 'a|b\\n' | tr '|' '-' > /tmp/piped.txt; cat /tmp/piped.txt`,
      'bypass'
    )

    expect(run.asked).toBe(false)
    expect(run.result).toContain('a-b')
  })

  it('asks before a command that no rule allows', async () => {
    await expect(runBash('pnpm test:unit')).resolves.toMatchObject({
      asked: true
    })
  })

  it('writes a source file without a question', async () => {
    const run = await runToolCall({
      name: 'write_file',
      input: { path: 'notes.md', content: 'hello\n' }
    })

    expect(run.asked).toBe(false)
    await expect(hostFree.sandbox.fs.read('/workspace/notes.md')).resolves.toBe(
      'hello\n'
    )
  })

  it('never writes a file outside the clone', async () => {
    const run = await runToolCall({
      name: 'write_file',
      input: { path: '/tmp/notes.md', content: 'hello\n' }
    })

    expect(run.asked).toBe(true)
    await expect(hostFree.sandbox.fs.read('/tmp/notes.md')).rejects.toThrow(
      'ENOENT'
    )
  })

  it.each([
    { name: 'bash', input: { command: 'pnpm test:unit' } },
    { name: 'write_file', input: { path: 'plan.md', content: 'plan\n' } }
  ])('blocks $name in plan mode', async (toolCall) => {
    const run = await runToolCall(toolCall, 'plan')

    expect(run.result).toContain(PLAN_DENIAL)
  })

  it('shows the model no sandbox secret', async () => {
    const run = await runBash('printenv NPM_TOKEN', 'bypass')

    expect(run.result).toContain('[redacted]')
    expect(run.result).not.toContain(SANDBOX_SECRETS.NPM_TOKEN)
    expect(run.modelContext).not.toContain(SANDBOX_SECRETS.NPM_TOKEN)
  })

  it('has no webfetch tool, so no fetch leaves the host', async () => {
    const run = await runToolCall({
      name: 'webfetch',
      input: { url: 'https://example.com' }
    })

    expect(run.result).toContain('Unknown tool: webfetch')
  })

  it('cuts a long host tool result before the model reads it', async () => {
    const run = await runWorkerToolCall({
      hostFree,
      toolCall: { name: LONG_HOST_TOOL, input: {} },
      plugins: [longHostTool]
    })

    expect(run.result).toMatch(
      /\[Output cut\. Showing the first \d+ of 3000 lines, 51200 of 105000 bytes\.\]$/u
    )
    expect(run.modelContext).toContain('[Output cut.')
  })

  it('retries a model call that the provider refuses as overloaded in the middle of a turn', async () => {
    const model = fakeText()
    model.setResponses([
      { toolCalls: [{ name: LONG_HOST_TOOL }] },
      { error: OVERLOADED_MODEL_ERROR },
      { text: 'Done after the retry.' }
    ])
    const host = createAgentHost({
      persistence: memoryPersistence(),
      logger: SILENT_HOST_LOGGER
    })
    const worker = defineTestWorker({
      host,
      model,
      hostFree,
      plugins: [longHostTool]
    })
    const inputId = 'overloaded-model'

    try {
      const session = await host.open(worker, {
        threadId: 'worker-overloaded-model',
        user: TEST_STARTER
      })
      await session.send('Answer once the model is back.', { inputId })

      await expect(session.settled({ inputId })).resolves.toMatchObject({
        outcome: 'completed'
      })
      expect(model.state.callCount).toBe(MODEL_CALLS_WITH_ONE_RETRY)
    } finally {
      await host.close()
    }
  })

  it('calls the model again when the output limit cuts an answer, and gives the cut call its result text', async () => {
    const model = fakeText()
    model.setResponses([
      { toolCalls: [{ name: LONG_HOST_TOOL }], finishReason: 'length' },
      { text: 'Done after the cut.' }
    ])
    const host = createAgentHost({
      persistence: memoryPersistence(),
      logger: SILENT_HOST_LOGGER
    })
    const worker = defineTestWorker({
      host,
      model,
      hostFree,
      plugins: [longHostTool]
    })
    const inputId = 'cut-answer'

    try {
      const session = await host.open(worker, {
        threadId: 'worker-cut-answer',
        user: TEST_STARTER
      })
      await session.send('Read the long result.', { inputId })

      await expect(session.settled({ inputId })).resolves.toMatchObject({
        outcome: 'completed'
      })
      const transcript = await session.transcript()

      expect(model.state.callCount).toBe(2)
      expect(transcript.slice(-LAST_TWO_MESSAGES)).toMatchObject([
        { role: 'tool', content: TRUNCATED_TOOL_RESULT },
        { role: 'assistant', content: 'Done after the cut.' }
      ])
    } finally {
      await host.close()
    }
  })

  it('continues an answer that a host stop cut, after the restart', async () => {
    const persistence = memoryPersistence()
    const answer = 'The first half of the answer, then the second half.'
    const cutModel = fakeText({ tokensPerSecond: 50 })
    cutModel.setResponses([{ text: answer }])
    const continuedFrom: ModelMessage[] = []
    const continuedModel = fakeText()
    continuedModel.setResponses([
      ({ request }) => {
        continuedFrom.push(...request.messages.slice(-LAST_TWO_MESSAGES))

        return { text: ' then the second half.' }
      }
    ])
    const threadId = 'worker-cut-by-a-stop'
    const inputId = 'cut-by-a-stop'
    const firstHost = createAgentHost({
      persistence,
      logger: SILENT_HOST_LOGGER
    })
    const first = await firstHost.open(
      defineTestWorker({ host: firstHost, model: cutModel, hostFree }),
      { threadId, user: TEST_STARTER }
    )
    const streamed = new Promise<void>((resolve) => {
      first.onEvent('TEXT_MESSAGE_CONTENT', () => {
        resolve()
      })
    })
    await first.send('Write the answer.', { inputId }).receipt
    await streamed
    await firstHost.close({ recoverable: true })

    const nextHost = createAgentHost({
      persistence,
      logger: SILENT_HOST_LOGGER
    })

    try {
      const next = await nextHost.open(
        defineTestWorker({ host: nextHost, model: continuedModel, hostFree }),
        { threadId, user: TEST_STARTER }
      )

      await expect(next.settled({ inputId })).resolves.toMatchObject({
        outcome: 'completed'
      })
      const cutAnswers = Array.from(
        { length: answer.length - 1 },
        (_, index) => {
          return answer.slice(0, index + 1)
        }
      )
      const [partial] = continuedFrom

      expect(cutAnswers).toContain(partial?.content)
      expect(continuedFrom).toMatchObject([
        { role: 'assistant' },
        { role: 'user', content: CUT_OFF_NOTE }
      ])
      expect([
        cutModel.state.callCount,
        continuedModel.state.callCount
      ]).toStrictEqual([1, 1])
    } finally {
      await nextHost.close()
    }
  })
})
