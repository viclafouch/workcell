import {
  defineHarness,
  type HarnessHost,
  type HarnessPersistence,
  type PermissionMode
} from '@tanstack/ai-harness'
import { permissions } from '@tanstack/ai-harness/plugins'
import {
  workspaceTools,
  type WorkspaceBinder
} from '@tanstack/ai-harness/plugins/coding'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { fakeText } from '@tanstack/ai/testing'
import { createAgentHost } from '#core/host/agent-host'
import { SILENT_HOST_LOGGER } from '#core/workers/test-doubles'
import type { ToolCall } from '#core/workers/tool-call'

type LibraryQuestionOptions = {
  workspace: WorkspaceBinder
  mode?: PermissionMode
  host?: HarnessHost
}

export function openQuestionHost(
  persistence: HarnessPersistence = memoryPersistence()
) {
  return createAgentHost({ persistence, logger: SILENT_HOST_LOGGER })
}

function defineQuestionHarness(
  workspace: WorkspaceBinder,
  turns: readonly ToolCall[][]
) {
  const model = fakeText()
  model.setResponses(
    turns.flatMap((toolCalls) => {
      return [
        ...toolCalls.map((toolCall) => {
          return { toolCalls: [toolCall] }
        }),
        { text: 'Done.' }
      ]
    })
  )

  return defineHarness({
    name: 'workcell/test-library-question',
    adapter: model,
    plugins: () => {
      return [permissions(), workspaceTools({ workspace, web: false })]
    }
  })
}

export async function openLibraryQuestion({
  workspace,
  turns,
  mode = 'plan',
  host = openQuestionHost()
}: LibraryQuestionOptions & { turns: readonly ToolCall[][] }) {
  const session = await host.open(defineQuestionHarness(workspace, turns), {
    threadId: 'library-question'
  })
  await session.setPluginSetting({ key: 'mode', value: mode })

  const ask = async () => {
    const results: string[] = []
    const stopListening = session.onEvent('TOOL_CALL_RESULT', ({ event }) => {
      results.push(
        typeof event.content === 'string'
          ? event.content
          : JSON.stringify(event.content)
      )
    })
    await session.send('Answer from the code.')
    stopListening()

    return results
  }

  return { ask }
}

export async function askLibraryQuestion({
  toolCalls,
  ...options
}: LibraryQuestionOptions & { toolCalls: ToolCall[] }) {
  const { ask } = await openLibraryQuestion({ ...options, turns: [toolCalls] })

  return ask()
}
