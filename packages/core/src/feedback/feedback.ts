import { once } from 'node:events'
import { z } from 'zod'
import {
  toolDefinition,
  type AfterToolCallInfo,
  type ChatMiddleware
} from '@tanstack/ai'
import {
  definePlugin,
  durableTool,
  PermissionRules
} from '@tanstack/ai-harness'
import corePackage from '@workcell/core/package.json' with { type: 'json' }
import {
  FEEDBACK_HINT,
  feedbackNotDeliveredLine,
  feedbackSentLine,
  FILLER_REFUSAL,
  SEND_FEEDBACK_TEXT
} from '#/prompts/feedback.ts'
import { agentMetadataSchema, type AgentMetadata } from '#/session/metadata.ts'

export const FEEDBACK_PLUGIN = 'workcell/feedback'

export const SEND_FEEDBACK = 'send_feedback'

export const FEEDBACK_RECORD = 'workcell.feedback'

const KEPT_FEEDBACK_RECORDS = 100

const DELIVERY_TIMEOUT_MS = 10_000

const MAX_TEXT_LENGTH = 4000

const TOOL_NAME = /^[\w.-]{1,40}$/u

const CUT_OFF_CALL = 'max_tokens'

const FILLER_TEXTS = new Set([
  '',
  'na',
  'none',
  'noop',
  'null',
  'placeholder',
  'tbd',
  'test',
  'todo',
  'undefined'
])

const reportTextSchema = z.string().trim().max(MAX_TEXT_LENGTH)

const reportInputSchema = z.object({
  kind: z
    .enum(['missing', 'broken', 'confusing', 'idea'])
    .describe(SEND_FEEDBACK_TEXT.kind),
  impact: z
    .enum(['blocked', 'worked_around', 'friction'])
    .describe(SEND_FEEDBACK_TEXT.impact),
  observed: reportTextSchema.describe(SEND_FEEDBACK_TEXT.observed),
  expected: reportTextSchema.describe(SEND_FEEDBACK_TEXT.expected),
  tool: z
    .string()
    .trim()
    .regex(TOOL_NAME)
    .optional()
    .describe(SEND_FEEDBACK_TEXT.tool),
  source: z.enum(['agent', 'user']).describe(SEND_FEEDBACK_TEXT.source)
})

const feedbackReportSchema = reportInputSchema.extend({
  id: z.string(),
  at: z.string(),
  harness: z.string(),
  agent: z.string().optional(),
  model: z.string(),
  task: z.string().optional(),
  threadId: z.string(),
  threadLink: z.string().optional(),
  runId: z.string(),
  reporter: z.string().optional(),
  version: z.string()
})

export type FeedbackReport = z.infer<typeof feedbackReportSchema>

const feedbackPluginStateSchema = z.object({
  reports: z.array(feedbackReportSchema)
})

export type FeedbackPluginState = z.infer<typeof feedbackPluginStateSchema>

export function feedbackReportsOf(plugins: Record<string, unknown>) {
  return (
    feedbackPluginStateSchema.safeParse(plugins[FEEDBACK_PLUGIN]).data
      ?.reports ?? []
  )
}

export type DeliverFeedback = (
  report: FeedbackReport,
  options: { signal: AbortSignal }
) => Promise<void>

export type FeedbackOptions = {
  deliver?: DeliverFeedback
  threadLink?: (thread: {
    threadId: string
    metadata: AgentMetadata | null
  }) => string | undefined
  deliveryTimeoutMs?: number
}

type FeedbackParams = FeedbackOptions & {
  harness: string
  agentName?: string
}

const toolErrorSchema = z.object({ error: z.string() })

const harnessRunContextSchema = z.object({
  run: z.object({
    runId: z.string(),
    user: z.object({ id: z.string() }).optional()
  })
})

const sendFeedbackDefinition = toolDefinition({
  name: SEND_FEEDBACK,
  description: SEND_FEEDBACK_TEXT.description,
  inputSchema: reportInputSchema
})

function isFiller(text: string) {
  return FILLER_TEXTS.has(text.toLowerCase().replaceAll(/[^\p{L}\p{N}]/gu, ''))
}

function errorOfCall({ ok, result, error }: AfterToolCallInfo) {
  if (ok) {
    return toolErrorSchema.safeParse(result).data?.error
  }

  if (error instanceof Error) {
    return 'code' in error && error.code === CUT_OFF_CALL
      ? undefined
      : error.message
  }

  return String(error)
}

async function deliverWithin(
  deliver: DeliverFeedback,
  report: FeedbackReport,
  timeoutMs: number
) {
  const signal = AbortSignal.timeout(timeoutMs)

  await Promise.race([
    deliver(report, { signal }),
    once(signal, 'abort').then(() => {
      throw new Error(`The delivery took more than ${timeoutMs} ms.`)
    })
  ])
}

export function feedback({
  harness,
  agentName,
  deliver,
  threadLink,
  deliveryTimeoutMs = DELIVERY_TIMEOUT_MS
}: FeedbackParams) {
  return definePlugin({
    name: FEEDBACK_PLUGIN,
    metadataSchema: agentMetadataSchema,
    keepRecords: { [FEEDBACK_RECORD]: KEPT_FEEDBACK_RECORDS },
    setup: (setupContext) => {
      const { threadId } = setupContext.session
      const sentReports = setupContext.state<FeedbackPluginState>({
        reports: []
      })
      let model = ''
      let metadata: AgentMetadata | null = null

      const reportFacts: ChatMiddleware = {
        name: FEEDBACK_PLUGIN,
        onStart: ({ model: modelOfTurn }) => {
          model = modelOfTurn
        },
        onAfterToolCall: (_ctx, info) => {
          const toolError =
            info.toolName === SEND_FEEDBACK ? undefined : errorOfCall(info)

          return toolError === undefined
            ? undefined
            : {
                type: 'replaceResult',
                result: { error: `${toolError}\n${FEEDBACK_HINT}` }
              }
        }
      }

      const sendFeedback = durableTool(
        sendFeedbackDefinition,
        async (input, { context, step, append }) => {
          if (isFiller(input.observed) || isFiller(input.expected)) {
            throw new Error(FILLER_REFUSAL)
          }

          const { run } = harnessRunContextSchema.parse(context)
          const report = await step.do('report', (): FeedbackReport => {
            return {
              ...input,
              id: crypto.randomUUID(),
              at: Temporal.Now.instant().toString(),
              harness,
              agent: metadata?.name ?? agentName,
              model,
              task: metadata?.task,
              threadId,
              threadLink: threadLink?.({ threadId, metadata }),
              runId: run.runId,
              reporter: run.user?.id,
              version: corePackage.version
            }
          })
          const isDelivered = await step.do('deliver', async () => {
            if (deliver === undefined) {
              return true
            }

            try {
              await deliverWithin(deliver, report, deliveryTimeoutMs)

              return true
            } catch (deliveryError) {
              setupContext.logger.warn(
                `[${FEEDBACK_PLUGIN}] A report was not delivered. The turn goes on.`,
                { error: deliveryError, feedbackId: report.id }
              )

              return false
            }
          })
          append([{ type: FEEDBACK_RECORD, ...report }])
          await sentReports.update((current) => {
            return {
              reports: [...current.reports, report].slice(
                -KEPT_FEEDBACK_RECORDS
              )
            }
          })

          return isDelivered
            ? feedbackSentLine(report.id)
            : feedbackNotDeliveredLine(report.id)
        },
        { replay: 'never' }
      )

      return {
        onTurnStart: async () => {
          const entry = await setupContext.session.indexEntry()
          metadata = entry?.metadata ?? null
        },
        middleware: [reportFacts],
        tools: [sendFeedback],
        contribute: [
          PermissionRules.item({ tool: SEND_FEEDBACK, decision: 'allow' })
        ]
      }
    }
  })
}
