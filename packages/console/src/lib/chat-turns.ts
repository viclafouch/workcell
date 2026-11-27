import type { ViewMessage, ViewPart } from '@tanstack/ai-harness/view'

export type PersonMessage = Extract<ViewMessage, { role: 'user' }>

export type AgentMessage = Extract<ViewMessage, { role: 'assistant' }>

type NoticeMessage = Extract<ViewMessage, { role: 'notice' }>

export type ChatTurn =
  | { kind: 'person'; id: string; message: PersonMessage }
  | { kind: 'agent'; id: string; messages: AgentMessage[] }
  | { kind: 'notice'; id: string; message: NoticeMessage }

const WORK_PART_TYPES = new Set<ViewPart['type']>([
  'tool-call',
  'reasoning',
  'agent'
])

const keptTurns = new WeakMap<ViewMessage, ChatTurn>()

const matchIsSameOperation = (turn: ChatTurn, message: AgentMessage) => {
  if (turn.kind !== 'agent') {
    return false
  }

  const { operationId } = turn.messages[0] ?? {}

  return (
    operationId === undefined ||
    message.operationId === undefined ||
    operationId === message.operationId
  )
}

const keptTurnOf = (turn: ChatTurn) => {
  const first = turn.kind === 'agent' ? turn.messages[0] : turn.message

  if (first === undefined) {
    return turn
  }

  const kept = keptTurns.get(first)
  const isSame =
    kept !== undefined &&
    kept.id === turn.id &&
    (turn.kind !== 'agent' ||
      (kept.kind === 'agent' &&
        kept.messages.length === turn.messages.length &&
        kept.messages.every((message, index) => {
          return message === turn.messages[index]
        })))

  if (isSame) {
    return kept
  }

  keptTurns.set(first, turn)

  return turn
}

export const groupChatTurns = (messages: readonly ViewMessage[]) => {
  const turns: ChatTurn[] = []

  for (const message of messages) {
    const last = turns.at(-1)

    if (message.role === 'user') {
      turns.push({ kind: 'person', id: message.id, message })
    } else if (message.role === 'notice') {
      turns.push({ kind: 'notice', id: message.id, message })
    } else if (last?.kind === 'agent' && matchIsSameOperation(last, message)) {
      last.messages.push(message)
    } else {
      turns.push({
        kind: 'agent',
        id: `turn:${message.operationId ?? message.id}`,
        messages: [message]
      })
    }
  }

  return turns.map(keptTurnOf)
}

export const splitAgentWork = (messages: readonly AgentMessage[]) => {
  const parts = messages.flatMap(({ parts: messageParts }) => {
    return messageParts
  })
  const lastWorkIndex = parts.findLastIndex(({ type }) => {
    return WORK_PART_TYPES.has(type)
  })

  return {
    work: parts.slice(0, lastWorkIndex + 1),
    answer: parts.slice(lastWorkIndex + 1)
  }
}

export const lastActivityOf = (messages: readonly AgentMessage[]) => {
  const last = messages.findLast(({ updatedAt, createdAt }) => {
    return (updatedAt ?? createdAt) !== undefined
  })

  return last?.updatedAt ?? last?.createdAt
}
