import type { TranscriptEvent } from 'vitest-evals'
import { normalizeContent, toJsonValue } from 'vitest-evals/harness'
import type { ModelMessage } from '@tanstack/ai'

function argumentsOf(text: string) {
  try {
    const parsed = toJsonValue(JSON.parse(text))

    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? parsed
      : { value: parsed ?? null }
  } catch {
    return { text }
  }
}

function eventsOf(message: ModelMessage): TranscriptEvent[] {
  if (message.role === 'tool') {
    return [
      {
        type: 'tool_result',
        toolCallId: message.toolCallId ?? '',
        content: normalizeContent(message.content)
      }
    ]
  }

  const text: TranscriptEvent[] =
    message.content === null || message.content === ''
      ? []
      : [
          {
            type: 'message',
            role: message.role,
            content: normalizeContent(message.content)
          }
        ]
  const calls = (message.toolCalls ?? []).map((call): TranscriptEvent => {
    return {
      type: 'tool_call',
      id: call.id,
      name: call.function.name,
      arguments: argumentsOf(call.function.arguments)
    }
  })

  return [...text, ...calls]
}

export function transcriptEvents(messages: readonly ModelMessage[]) {
  return messages.flatMap(eventsOf)
}
