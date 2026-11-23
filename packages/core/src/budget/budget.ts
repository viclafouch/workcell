import { z } from 'zod'
import {
  createCapability,
  defineInterrupt,
  type AgentLoopStrategy,
  type ChatMiddleware,
  type ChatMiddlewareContext,
  type TokenUsage
} from '@tanstack/ai'
import {
  definePlugin,
  type HarnessRunContext,
  type SessionUsage
} from '@tanstack/ai-harness'
import { formatTodos, type usage } from '@tanstack/ai-harness/plugins'
import { SummaryMiddleware } from '#/host/durable-compaction.ts'
import { budgetAnswerPrompt } from '#/prompts/worker.ts'
import { agentMetadataSchema, type AgentMetadata } from '#/session/metadata.ts'
import { todosOf } from '#/session/todo-list.ts'
import { EntrySkillLimits, type BudgetLimits } from './limits.ts'

const BUDGET_PLUGIN = 'workcell/worker-budget'

export const BUDGET_END_EVENT = 'workcell.budget-end'

type UsagePluginOptions = NonNullable<Parameters<typeof usage>[0]>

export type ModelPricing = {
  requirePrices: (modelIds: readonly string[]) => void
  costOfCall: (modelId: string, usage: TokenUsage) => number
  costOfUsage: (usage: SessionUsage) => number
  modelCost: NonNullable<UsagePluginOptions['model']>
}

type StopFacts = {
  agent: string
  spentUsd: number
  capUsd: number
  modelCalls: number
  maxCostUsd: number
}

const budgetStateSchema = z.object({
  spentAtLastAnswerUsd: z.number(),
  summaryUsd: z.number(),
  summaryCalls: z.number(),
  capUsd: z.number().optional()
})

type BudgetState = z.infer<typeof budgetStateSchema>

const NOTHING_SPENT: BudgetState = {
  spentAtLastAnswerUsd: 0,
  summaryUsd: 0,
  summaryCalls: 0
}

export function budgetStateOf(plugins: Record<string, unknown>) {
  return budgetStateSchema.safeParse(plugins[BUDGET_PLUGIN]).data
}

export function dollars(amount: number) {
  return `$${amount.toFixed(2)}`
}

const BUDGET_STOP = {
  logLine: 'worker budget reached',
  ask: ({ agent, spentUsd, capUsd, modelCalls, maxCostUsd }: StopFacts) => {
    return `${agent} used its budget for this task: ${dollars(spentUsd)} of ${dollars(capUsd)}, in ${modelCalls} model calls. Answer to go on with ${dollars(maxCostUsd)} more, or to stop here.`
  },
  end: ({ agent, spentUsd, capUsd, modelCalls }: StopFacts) => {
    return `${agent} used its budget for this conversation: ${dollars(spentUsd)} of ${dollars(capUsd)}, in ${modelCalls} model calls. It stops here: start a new conversation to go on.`
  }
}

const BUDGET_ANSWER =
  'The answer of the person, in their own words. The worker reads it and decides whether to go on.'

export const budgetStop = defineInterrupt({
  id: 'workcell/worker-budget-stop',
  responseSchema: z.string().describe(BUDGET_ANSWER)
})

const budgetAnswer = createCapability<{ prompt?: string }>()(
  'workcell/budget-answer'
)

const [budgetAnswerOf, provideBudgetAnswer] = budgetAnswer

export const untilABudgetStop: AgentLoopStrategy = () => {
  return true
}

type WorkerBudgetParams = {
  pricing: ModelPricing
  defaultLimits: BudgetLimits
  agentName?: string
  onLimit?: 'ask' | 'end'
}

type LogTurnParams = { context: HarnessRunContext }

function whereItStands(plugins: Record<string, unknown>) {
  const items = todosOf(plugins) ?? []

  return items.length > 0 ? `\nWhere it stands:\n${formatTodos(items)}` : ''
}

export function workerBudget({
  pricing,
  defaultLimits,
  agentName = 'The worker',
  onLimit = 'ask'
}: WorkerBudgetParams) {
  return definePlugin({
    name: BUDGET_PLUGIN,
    metadataSchema: agentMetadataSchema,
    setup: (setupContext) => {
      const { threadId } = setupContext.session
      const saved = setupContext.state(NOTHING_SPENT)
      let metadata: AgentMetadata = {}
      let limits: BudgetLimits = defaultLimits
      let loggedUsd = 0
      let loggedCalls = 0
      let summaryUsd = 0
      let summaryCalls = 0
      let turnUsd = 0
      let turnCalls = 0
      let turnTokens = 0

      const spentUsd = () => {
        return loggedUsd + summaryUsd + turnUsd
      }

      const modelCalls = () => {
        return loggedCalls + summaryCalls + turnCalls
      }

      const totals = () => {
        return {
          threadId,
          name: metadata.name,
          modelCalls: modelCalls(),
          spentUsd: spentUsd(),
          turnModelCalls: turnCalls,
          turnTokens,
          turnUsd
        }
      }

      const logTurn = ({ context }: LogTurnParams) => {
        if (context.run.source === 'turn') {
          setupContext.logger.info(
            `[${BUDGET_PLUGIN}] worker turn usage`,
            totals()
          )
        }
      }

      const reachedBudget = async () => {
        const { spentAtLastAnswerUsd } = await saved.get()
        const capUsd = spentAtLastAnswerUsd + limits.maxCostUsd

        if (spentUsd() < capUsd) {
          return
        }

        setupContext.logger.warn(`[${BUDGET_PLUGIN}] ${BUDGET_STOP.logLine}`, {
          ...totals(),
          capUsd,
          limits
        })

        return {
          agent: metadata.name ?? agentName,
          spentUsd: spentUsd(),
          capUsd,
          modelCalls: modelCalls(),
          maxCostUsd: limits.maxCostUsd
        }
      }

      const endsTurn = async (
        chat: ChatMiddlewareContext<HarnessRunContext>
      ) => {
        if (onLimit !== 'end' || chat.context.run.source !== 'turn') {
          return false
        }

        const facts = await reachedBudget()

        if (facts === undefined) {
          return false
        }

        chat.emitCustomEvent(BUDGET_END_EVENT, {
          reason: 'budget',
          message: BUDGET_STOP.end(facts)
        })

        return true
      }

      const budget: ChatMiddleware<HarnessRunContext, typeof budgetStop> = {
        name: BUDGET_PLUGIN,
        provides: [budgetAnswer],
        setup: (chat) => {
          provideBudgetAnswer(chat, {})
        },
        onStart: async (chat) => {
          if (chat.context.run.source !== 'turn') {
            return
          }

          const { usage: loggedUsage } = setupContext.session.snapshot()
          const {
            summaryUsd: savedSummaryUsd,
            summaryCalls: savedSummaryCalls
          } = await saved.get()
          loggedUsd = pricing.costOfUsage(loggedUsage)
          loggedCalls = loggedUsage.total.calls
          summaryUsd = savedSummaryUsd
          summaryCalls = savedSummaryCalls
          turnUsd = 0
          turnCalls = 0
          turnTokens = 0

          if (await endsTurn(chat)) {
            chat.abort(BUDGET_END_EVENT)
          }
        },
        onUsage: ({ model }, callUsage) => {
          turnUsd += pricing.costOfCall(model, callUsage)
          turnCalls += 1
          turnTokens += callUsage.totalTokens
        },
        onShouldContinue: async (chat) => {
          return !(await endsTurn(chat))
        },
        onInterruptBoundary: async ({ phase, context, iteration, runId }) => {
          if (
            onLimit !== 'ask' ||
            phase !== 'beforeModel' ||
            context.run.source !== 'turn'
          ) {
            return
          }

          const facts = await reachedBudget()

          if (facts === undefined) {
            return
          }

          return {
            interrupts: [
              budgetStop.interrupt({
                key: `${runId}:${iteration}`,
                reason: 'budget',
                message: `${BUDGET_STOP.ask(facts)}${whereItStands(setupContext.session.snapshot().plugins)}`
              })
            ]
          }
        },
        onInterruptResolution: async (chat, resolutions) => {
          const [answer] = resolutions.for(budgetStop)

          if (answer === undefined) {
            return
          }

          setupContext.logger.info(
            `[${BUDGET_PLUGIN}] worker budget answered`,
            {
              threadId,
              name: metadata.name,
              isAnswered: answer.status === 'resolved'
            }
          )

          if (answer.status === 'resolved') {
            budgetAnswerOf(chat).prompt = budgetAnswerPrompt(
              answer.request.message,
              answer.response
            )
            const spentAtLastAnswerUsd =
              pricing.costOfUsage(setupContext.session.snapshot().usage) +
              summaryUsd
            await saved.update((current) => {
              return {
                ...current,
                spentAtLastAnswerUsd,
                capUsd: spentAtLastAnswerUsd + limits.maxCostUsd
              }
            })

            return
          }

          return { toolResume: 'stop' }
        },
        onConfig: (chat, config) => {
          const { prompt } = budgetAnswerOf(chat)

          return chat.phase !== 'beforeModel' || prompt === undefined
            ? undefined
            : { systemPrompts: [...config.systemPrompts, prompt] }
        },
        onFinish: logTurn,
        onAbort: logTurn,
        onError: logTurn
      }

      const countSummary: ChatMiddleware = {
        name: `${BUDGET_PLUGIN}/summary`,
        onUsage: async ({ model }, callUsage) => {
          const costUsd = pricing.costOfCall(model, callUsage)
          summaryUsd += costUsd
          summaryCalls += 1
          await saved.update((current) => {
            return {
              ...current,
              summaryUsd: current.summaryUsd + costUsd,
              summaryCalls: current.summaryCalls + 1
            }
          })
        }
      }

      return {
        onTurnStart: async () => {
          const entry = await setupContext.session.indexEntry()
          metadata = entry?.metadata ?? {}
          limits =
            setupContext.collect(EntrySkillLimits).findLast((item) => {
              return item.entrySkill === metadata.entrySkill
            })?.limits ?? defaultLimits
          await saved.update((current) => {
            const capUsd = current.spentAtLastAnswerUsd + limits.maxCostUsd

            return current.capUsd === capUsd ? current : { ...current, capUsd }
          })
        },
        middleware: [budget],
        contribute: [SummaryMiddleware.item(countSummary)]
      }
    }
  })
}
