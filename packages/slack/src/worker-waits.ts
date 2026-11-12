import { z } from 'zod'
import {
  INTERRUPT_PAYLOAD_METADATA_KEY,
  type Interrupt,
  type ModelMessage
} from '@tanstack/ai'
import { waitKind, type WaitKind } from '@tanstack/ai-harness'

const jsonArgumentsSchema = z.string().transform((text, context) => {
  try {
    const parsed: unknown = JSON.parse(text)

    return parsed
  } catch {
    context.addIssue({ code: 'custom', message: 'The arguments are not JSON.' })

    return z.NEVER
  }
})

const commandArgumentsSchema = jsonArgumentsSchema.pipe(
  z.object({ command: z.string() })
)

const approvalPayloadSchema = z.object({
  toolCallId: z.string(),
  tool: z.string()
})

const questionPayloadSchema = z.object({
  toolCallId: z.string(),
  index: z.number()
})

const questionArgumentsSchema = jsonArgumentsSchema.pipe(
  z.object({
    questions: z.array(
      z.object({
        question: z.string(),
        header: z.string().optional(),
        options: z.array(
          z.object({ label: z.string(), description: z.string().optional() })
        )
      })
    )
  })
)

type RunMessages = readonly ModelMessage[]

type ShownQuestionParams = z.infer<
  typeof questionArgumentsSchema
>['questions'][number]

function callArguments(messages: RunMessages, toolCallId: string) {
  return messages
    .flatMap(({ toolCalls = [] }) => {
      return toolCalls
    })
    .find(({ id }) => {
      return id === toolCallId
    })?.function.arguments
}

function shownCall(tool: string, args: string) {
  return (
    commandArgumentsSchema.safeParse(args).data?.command ?? `${tool} ${args}`
  )
}

function shownQuestion({ header, question, options }: ShownQuestionParams) {
  const title = header ? `${header}: ${question}` : question
  const lines = options.map(({ label, description }, index) => {
    return `${index + 1}. ${label}${description ? ` - ${description}` : ''}`
  })

  return [title, ...lines].join('\n')
}

function approvalText(payload: unknown, messages: RunMessages) {
  const approval = approvalPayloadSchema.safeParse(payload).data
  const args =
    approval === undefined
      ? undefined
      : callArguments(messages, approval.toolCallId)

  return approval === undefined || args === undefined
    ? undefined
    : shownCall(approval.tool, args)
}

function questionText(payload: unknown, messages: RunMessages) {
  const asked = questionPayloadSchema.safeParse(payload).data
  const item =
    asked === undefined
      ? undefined
      : questionArgumentsSchema.safeParse(
          callArguments(messages, asked.toolCallId)
        ).data?.questions[asked.index]

  return item === undefined ? undefined : shownQuestion(item)
}

const WAIT_TEXT: Partial<
  Record<
    WaitKind,
    (payload: unknown, messages: RunMessages) => string | undefined
  >
> = {
  approval: approvalText,
  question: questionText
}

export type PostedWait = { waitId: string; text: string }

export type StoppedWait = PostedWait & { kind: WaitKind }

export function stoppedWait(
  interrupt: Interrupt,
  messages: RunMessages
): StoppedWait {
  const kind = waitKind(interrupt)
  const payload: unknown = interrupt.metadata?.[INTERRUPT_PAYLOAD_METADATA_KEY]

  return {
    waitId: interrupt.id,
    kind,
    text: WAIT_TEXT[kind]?.(payload, messages) ?? interrupt.message ?? ''
  }
}

export function waitIdOf({ waitId }: PostedWait) {
  return waitId
}

export function waitsOfKind(
  waits: readonly StoppedWait[],
  kind: StoppedWait['kind']
) {
  return waits.filter((wait) => {
    return wait.kind === kind
  })
}

export function unaskedApprovals(
  waits: readonly PostedWait[],
  askedWaits: readonly string[]
) {
  return waits.filter(({ waitId }, index) => {
    return (
      !askedWaits.includes(waitId) &&
      waits.findIndex((wait) => {
        return wait.waitId === waitId
      }) === index
    )
  })
}
