import type { ModelMessage } from '@tanstack/ai'
import { projectCompaction } from '@tanstack/ai-compaction'
import type { HarnessDurability } from '@tanstack/ai-harness'

export const CUT_OFF_NOTE =
  'The previous answer was cut off. Continue exactly where it stopped, without repeating it.'

export const TRUNCATED_TOOL_RESULT =
  'The answer was cut off at the output limit before this tool call was complete. The call did not run.'

export const INTERRUPTED_TOOL_RESULT =
  'The tool may or may not have run. Check before you retry. A send_feedback report that a host restart cut is never sent again.'

const CUT_OFF_TAIL_MESSAGES = 3

export const AGENT_DURABILITY = {
  addRecordsToModelContext: { version: 'v1', record: projectCompaction },
  continueCutOff: { note: CUT_OFF_NOTE },
  interruptedToolResult: INTERRUPTED_TOOL_RESULT
} satisfies HarnessDurability

export const WORKER_DURABILITY = {
  ...AGENT_DURABILITY,
  truncatedToolResult: TRUNCATED_TOOL_RESULT
} satisfies HarnessDurability

export function joinCutOffAnswer(
  messages: readonly ModelMessage[],
  answer: string
) {
  const [partial, note] = messages.slice(-CUT_OFF_TAIL_MESSAGES, -1)

  return partial?.role === 'assistant' &&
    typeof partial.content === 'string' &&
    note?.role === 'user' &&
    note.content === CUT_OFF_NOTE
    ? `${partial.content}${answer}`
    : answer
}
