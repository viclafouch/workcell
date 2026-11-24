import { z } from 'zod'
import {
  combineStrategies,
  defineAgent,
  maxIterations,
  untilFinishReason,
  type AnyTextAdapter,
  type AnyTool
} from '@tanstack/ai'
import { definePlugin } from '@tanstack/ai-harness'
import { SUBAGENT_TEXT } from '#/prompts/worker.ts'

const SUBAGENT_TOOL_NAME = 'subagent'

const MAX_SUBAGENT_MODEL_CALLS = 50

export function workerSubagent(adapter: AnyTextAdapter) {
  return definePlugin({
    name: 'workcell/subagent',
    setup: () => {
      let turnTools: readonly AnyTool[] | null = null

      return {
        prepareTools: ({ tools }) => {
          turnTools = tools

          return tools
        },
        subagents: [
          defineAgent({
            name: SUBAGENT_TOOL_NAME,
            description: SUBAGENT_TEXT.description,
            inputSchema: z.object({
              task: z.string().describe(SUBAGENT_TEXT.task)
            }),
            run: (child) => {
              if (turnTools === null) {
                throw new Error(SUBAGENT_TEXT.noTurn)
              }

              return child.chat({
                adapter,
                messages: [{ role: 'user', content: child.input.task }],
                tools: [...turnTools],
                agentLoopStrategy: combineStrategies([
                  maxIterations(MAX_SUBAGENT_MODEL_CALLS),
                  untilFinishReason(['length'])
                ])
              })
            }
          })
        ]
      }
    }
  })
}
