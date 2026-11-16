import type { CardChild, CardElement, TextElement } from 'chat'
import type { Todo } from '@tanstack/ai-harness/plugins'
import type { WorkerApproval } from '@workcell/core'
import { APPROVAL_ACTIONS, STOP_ACTION } from '#/connection/chat-connection.ts'
import type { ChatMessage } from '#/connection/chat-surface.ts'
import type { ChatLines } from '#/prompts/chat.ts'
import type { PostedWait } from './worker-waits.ts'

export type WorkerThreadLink = { id: string; label: string; url: string }

const MAX_PLAN_TASKS = 50

function card(children: CardChild[], title?: string): CardElement {
  return { type: 'card', title, children }
}

function textElement(
  content: string,
  style?: TextElement['style']
): TextElement {
  return { type: 'text', content, style }
}

const TODO_MARK: Record<Todo['status'], string> = {
  pending: '·',
  in_progress: '→',
  done: '✓'
}

type OpeningCardParams = {
  line: string
  links: readonly WorkerThreadLink[]
  approvers: readonly string[]
  lines: ChatLines
}

export function openingCard({
  line,
  links,
  approvers,
  lines
}: OpeningCardParams): ChatMessage {
  return {
    fallbackText: line,
    card: card([
      textElement(line),
      {
        type: 'actions',
        children: [
          ...links.map(({ id, label, url }) => {
            return {
              type: 'link-button' as const,
              id: `worker_link_${id}`,
              label,
              url
            }
          }),
          {
            type: 'button',
            id: STOP_ACTION,
            label: lines.stop,
            style: 'danger',
            visibleTo: [...approvers]
          }
        ]
      }
    ])
  }
}

export function planCard(
  todos: readonly Todo[],
  lines: ChatLines
): ChatMessage {
  const done = todos.filter(({ status }) => {
    return status === 'done'
  })
  const steps = todos
    .slice(0, MAX_PLAN_TASKS)
    .map(({ text, status }) => {
      return `${TODO_MARK[status]} ${text}`
    })
    .join('\n')

  return {
    fallbackText: lines.planProgress({
      done: done.length,
      total: todos.length
    }),
    card: card([textElement(steps)], lines.planTitle)
  }
}

type ApprovalCardParams = {
  approvals: readonly PostedWait[]
  approvers: readonly string[]
  lines: ChatLines
}

export function approvalCard({
  approvals,
  approvers,
  lines
}: ApprovalCardParams): ChatMessage {
  const waitId = approvals[0]?.waitId ?? ''
  const calls = approvals
    .map(({ text }) => {
      return text
    })
    .join('\n')
  const asked = `${lines.approvalQuestion}\n\`\`\`\n${calls}\n\`\`\``
  const visibleTo = [...approvers]

  return {
    fallbackText: asked,
    card: card([
      textElement(asked),
      {
        type: 'actions',
        children: [
          {
            type: 'button',
            id: APPROVAL_ACTIONS.once,
            label: lines.approve,
            style: 'primary',
            value: waitId,
            visibleTo
          },
          {
            type: 'button',
            id: APPROVAL_ACTIONS.reject,
            label: lines.reject,
            style: 'danger',
            value: waitId,
            visibleTo
          }
        ]
      }
    ])
  }
}

type DecidedCardParams = {
  asked: string
  answer: WorkerApproval['answer']
  approver: string
  lines: ChatLines
}

export function decidedCard({
  asked,
  answer,
  approver,
  lines
}: DecidedCardParams): ChatMessage {
  const decision = `${approver} ${lines.decisions[answer]}`

  return {
    fallbackText: `${asked}\n${decision}`,
    card: card([textElement(asked), textElement(decision, 'muted')])
  }
}
