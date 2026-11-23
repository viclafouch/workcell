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

type RunMessages = readonly ModelMessage[]

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
    text:
      (kind === 'approval' ? approvalText(payload, messages) : undefined) ??
      interrupt.message ??
      ''
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
