import { z } from 'zod'
import type { ChatMiddleware } from '@tanstack/ai'
import {
  definePlugin,
  type HarnessRunContext,
  type OperationReport
} from '@tanstack/ai-harness'
import { scrubSecrets } from '@tanstack/ai/byok'
import type { ModelPricing } from '#/budget/budget.ts'

const ACTIVITY_PLUGIN = 'workcell/worker-activity'

const TURN_OPERATION_KINDS = new Set(['chat', 'command'])

const COMMAND_MAX_LENGTH = 200

const commandArgsSchema = z.object({ command: z.string() })

const pathArgsSchema = z.object({ path: z.string() })

type TurnPhase = 'setup' | 'model' | 'tool'

export type TurnActivity = {
  operationId: string
  phase: TurnPhase
  command?: string
  turnUsd: number
}

type CreateWorkerActivityParams = {
  pricing: ModelPricing
  secretValues: readonly string[]
}

function commandOf(toolName: string, args: unknown) {
  const command = commandArgsSchema.safeParse(args)
  const path = pathArgsSchema.safeParse(args)

  if (command.success) {
    return command.data.command.trim().split('\n')[0] ?? ''
  }

  return path.success ? `${toolName} ${path.data.path}` : toolName
}

function isTopLevelTurn({ phase, operation }: OperationReport) {
  return (
    phase === 'started' &&
    operation.parentRunId === undefined &&
    TURN_OPERATION_KINDS.has(operation.kind)
  )
}

export function createWorkerActivity({
  pricing,
  secretValues
}: CreateWorkerActivityParams) {
  const activitiesOutsideTheLog = new Map<string, TurnActivity>()

  const onOperation = (report: OperationReport) => {
    const { threadId, id } = report.operation

    if (isTopLevelTurn(report)) {
      activitiesOutsideTheLog.set(threadId, {
        operationId: id,
        phase: 'setup',
        turnUsd: 0
      })

      return
    }

    if (
      report.phase === 'settled' &&
      activitiesOutsideTheLog.get(threadId)?.operationId === id
    ) {
      activitiesOutsideTheLog.delete(threadId)
    }
  }

  const plugin = definePlugin({
    name: ACTIVITY_PLUGIN,
    setup: (setupContext) => {
      const { threadId } = setupContext.session
      let isStartupKept = false

      const update = (
        { context }: { context: HarnessRunContext },
        change: (current: TurnActivity) => Partial<TurnActivity>
      ) => {
        const current = activitiesOutsideTheLog.get(threadId)

        if (current !== undefined && context.run.source === 'turn') {
          activitiesOutsideTheLog.set(threadId, {
            ...current,
            ...change(current)
          })
        }
      }

      const keepStartup = async () => {
        try {
          await setupContext.session.updateIndexEntry((current) => {
            return current.metadata?.startupMs === undefined
              ? {
                  metadata: {
                    ...current.metadata,
                    startupMs: Date.now() - current.createdAt
                  }
                }
              : undefined
          })
        } catch (error) {
          setupContext.logger.warn(
            `[${ACTIVITY_PLUGIN}] startup time not kept`,
            { error }
          )
        }
      }

      const followTurn: ChatMiddleware<HarnessRunContext> = {
        name: ACTIVITY_PLUGIN,
        onIteration: async (chat) => {
          update(chat, () => {
            return { phase: 'model', command: undefined }
          })

          if (!isStartupKept && chat.context.run.source === 'turn') {
            isStartupKept = true
            await keepStartup()
          }
        },
        onBeforeToolCall: (chat, { toolName, args }) => {
          update(chat, () => {
            return {
              phase: 'tool',
              command: scrubSecrets(
                commandOf(toolName, args),
                secretValues
              ).slice(0, COMMAND_MAX_LENGTH)
            }
          })
        },
        onAfterToolCall: (chat) => {
          update(chat, () => {
            return { phase: 'model', command: undefined }
          })
        },
        onUsage: (chat, usage) => {
          update(chat, ({ turnUsd }) => {
            return { turnUsd: turnUsd + pricing.costOfCall(chat.model, usage) }
          })
        }
      }

      return { middleware: [followTurn] }
    }
  })

  return {
    onOperation,
    plugin,
    activityOf: (threadId: string) => {
      return activitiesOutsideTheLog.get(threadId)
    }
  }
}

export type WorkerActivity = ReturnType<typeof createWorkerActivity>
