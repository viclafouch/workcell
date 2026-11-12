import {
  metrics,
  trace,
  type Attributes,
  type MeterProvider,
  type Span,
  type TracerProvider
} from '@opentelemetry/api'
import type {
  ChatMiddleware,
  ChatMiddlewareContext,
  TokenUsage
} from '@tanstack/ai'
import { definePlugin } from '@tanstack/ai-harness'
import {
  otelMiddleware,
  type OtelSpanInfo
} from '@tanstack/ai/middlewares/otel'
import type { ModelPricing } from '#core/budget/budget'
import { SummaryMiddleware } from '#core/host/durable-compaction'
import { agentMetadataSchema, type AgentMetadata } from '#core/workers/metadata'

const TELEMETRY_PLUGIN = 'workcell/worker-telemetry'

const INSTRUMENTATION_SCOPE = 'workcell'

const COST_ATTRIBUTE = 'gen_ai.usage.cost'

export type WorkerObservability = {
  tracerProvider?: TracerProvider
  meterProvider?: MeterProvider
}

type WorkerTelemetryParams = WorkerObservability & {
  pricing: ModelPricing
}

type ChatUsages = {
  usages: TokenUsage[]
  usageOfOpenSpan?: TokenUsage
}

function taskAttributes(
  threadId: string,
  metadata?: AgentMetadata
): Attributes {
  const attributes = {
    'gen_ai.conversation.id': threadId,
    'gen_ai.agent.name': metadata?.name,
    'workcell.task.repository': metadata?.repository,
    'workcell.task.entry_skill': metadata?.entrySkill,
    'workcell.task.subject': metadata?.subject
  }

  return Object.fromEntries(
    Object.entries(attributes).filter((entry): entry is [string, string] => {
      return entry[1] !== undefined
    })
  )
}

export function workerTelemetry({
  tracerProvider = trace.getTracerProvider(),
  meterProvider = metrics.getMeterProvider(),
  pricing
}: WorkerTelemetryParams) {
  const tracer = tracerProvider.getTracer(INSTRUMENTATION_SCOPE)
  const meter = meterProvider.getMeter(INSTRUMENTATION_SCOPE)

  return definePlugin({
    name: TELEMETRY_PLUGIN,
    metadataSchema: agentMetadataSchema,
    setup: (setupContext) => {
      const { threadId } = setupContext.session
      const usagesOfChats = new WeakMap<ChatMiddlewareContext, ChatUsages>()
      let attributes = taskAttributes(threadId)

      const usagesOf = (chat: ChatMiddlewareContext) => {
        const chatUsages = usagesOfChats.get(chat) ?? { usages: [] }
        usagesOfChats.set(chat, chatUsages)

        return chatUsages
      }

      const priceUnpricedSpan = (info: OtelSpanInfo, span: Span) => {
        if (info.kind === 'iteration') {
          const chatUsages = usagesOf(info.ctx)
          const usage = chatUsages.usageOfOpenSpan
          chatUsages.usageOfOpenSpan = undefined

          if (usage !== undefined && usage.cost === undefined) {
            span.setAttribute(
              COST_ATTRIBUTE,
              pricing.costOfCall(info.ctx.model, usage)
            )
          }
        }

        if (info.kind === 'chat') {
          const { usages } = usagesOf(info.ctx)
          usagesOfChats.delete(info.ctx)

          if (
            usages.some(({ cost }) => {
              return cost === undefined
            })
          ) {
            span.setAttribute(
              COST_ATTRIBUTE,
              usages.reduce((total, usage) => {
                return total + pricing.costOfCall(info.ctx.model, usage)
              }, 0)
            )
          }
        }
      }

      const recordUsages: ChatMiddleware = {
        name: TELEMETRY_PLUGIN,
        onUsage: (chat, usage) => {
          const chatUsages = usagesOf(chat)
          chatUsages.usages.push(usage)
          chatUsages.usageOfOpenSpan = usage
        }
      }
      const traceRun = otelMiddleware({
        tracer,
        meter,
        attributeEnricher: () => {
          return attributes
        },
        onSpanEnd: priceUnpricedSpan
      })

      return {
        onTurnStart: async () => {
          const entry = await setupContext.session.indexEntry()
          attributes = taskAttributes(threadId, entry?.metadata)
        },
        middleware: [recordUsages, traceRun],
        agentMiddleware: [recordUsages, traceRun],
        contribute: [
          SummaryMiddleware.item(recordUsages),
          SummaryMiddleware.item(traceRun)
        ]
      }
    }
  })
}
