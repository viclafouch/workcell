import { z } from 'zod'
import {
  combineStrategies,
  defineAgent,
  EventType,
  maxIterations,
  untilFinishReason,
  type AnyTextAdapter,
  type AnyTool,
  type ChatMiddleware,
  type StreamChunk
} from '@tanstack/ai'
import { definePlugin } from '@tanstack/ai-harness'
import type { ModelPricing } from '#/budget/budget.ts'
import { SUBAGENT_TEXT } from '#/prompts/worker.ts'

const SUBAGENT_PLUGIN = 'workcell/subagent'

const SUBAGENT_TOOL_NAME = 'subagent'

const MAX_SUBAGENT_MODEL_CALLS = 50

const subagentRunSchema = z.object({
  toolCallId: z.string().optional(),
  task: z.string(),
  model: z.string(),
  outcome: z.enum(['finished', 'error']),
  error: z.string().optional(),
  modelCalls: z.number(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  cachedTokens: z.number(),
  totalTokens: z.number(),
  costUsd: z.number(),
  startedAt: z.number(),
  endedAt: z.number()
})

export type SubagentRun = z.infer<typeof subagentRunSchema>

const subagentLedgerSchema = z.object({
  runs: z.record(z.string(), subagentRunSchema)
})

type SubagentLedger = z.infer<typeof subagentLedgerSchema>

type OpenRun = Omit<SubagentRun, 'outcome' | 'error' | 'endedAt'>

type WorkerSubagentParams = {
  adapter: AnyTextAdapter
  pricing: Pick<ModelPricing, 'costOfCall'>
}

export function subagentRunsOf(plugins: Record<string, unknown>) {
  return (
    subagentLedgerSchema.safeParse(plugins[SUBAGENT_PLUGIN]).data?.runs ?? {}
  )
}

function endOf(chunk: StreamChunk) {
  if (chunk.type === EventType.SUBAGENT_FINISHED) {
    return { subagentRunId: chunk.subagentRunId, outcome: 'finished' as const }
  }

  if (chunk.type === EventType.SUBAGENT_ERROR) {
    return {
      subagentRunId: chunk.subagentRunId,
      outcome: 'error' as const,
      error: chunk.message
    }
  }

  return null
}

export function workerSubagent({ adapter, pricing }: WorkerSubagentParams) {
  return definePlugin({
    name: SUBAGENT_PLUGIN,
    setup: (setupContext) => {
      const ledger = setupContext.state<SubagentLedger>({ runs: {} })
      const openRuns = new Map<string, OpenRun>()
      let turnTools: readonly AnyTool[] | null = null

      const openRun = (subagentRunId: string) => {
        return openRuns.getOrInsertComputed(subagentRunId, () => {
          return {
            task: '',
            model: '',
            modelCalls: 0,
            promptTokens: 0,
            completionTokens: 0,
            cachedTokens: 0,
            totalTokens: 0,
            costUsd: 0,
            startedAt: Temporal.Now.instant().epochMilliseconds
          }
        })
      }

      const countChildCall: ChatMiddleware = {
        name: `${SUBAGENT_PLUGIN}/usage`,
        onStart: ({ subagentRunId, model }) => {
          if (subagentRunId !== undefined) {
            openRun(subagentRunId).model = model
          }
        },
        onUsage: ({ subagentRunId, model }, usage) => {
          if (subagentRunId === undefined) {
            return
          }

          const run = openRun(subagentRunId)
          run.model = model
          run.modelCalls += 1
          run.promptTokens += usage.promptTokens
          run.completionTokens += usage.completionTokens
          run.cachedTokens += usage.promptTokensDetails?.cachedTokens ?? 0
          run.totalTokens += usage.totalTokens
          run.costUsd += pricing.costOfCall(model, usage)
        }
      }

      const recordChildEnd: ChatMiddleware = {
        name: `${SUBAGENT_PLUGIN}/ledger`,
        onChunk: async (_chat, chunk) => {
          if (chunk.type === EventType.SUBAGENT_STARTED) {
            openRun(chunk.subagentRunId).toolCallId = chunk.parentToolCallId

            return
          }

          const end = endOf(chunk)
          const run = end === null ? undefined : openRuns.get(end.subagentRunId)

          if (end === null || run === undefined) {
            return
          }

          openRuns.delete(end.subagentRunId)
          const { subagentRunId, ...outcome } = end
          await ledger.update((current) => {
            return {
              runs: {
                ...current.runs,
                [subagentRunId]: {
                  ...run,
                  ...outcome,
                  endedAt: Temporal.Now.instant().epochMilliseconds
                }
              }
            }
          })
        }
      }

      return {
        prepareTools: ({ tools }) => {
          turnTools = tools

          return tools
        },
        middleware: [recordChildEnd],
        agentMiddleware: [countChildCall],
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

              openRun(child.subagentRunId).task = child.input.task

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
