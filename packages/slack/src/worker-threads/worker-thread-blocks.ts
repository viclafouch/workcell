import type { Todo } from '@tanstack/ai-harness/plugins'
import type { WorkerApproval } from '@workcell/core'
import type {
  SlackBlock,
  SlackContent,
  SlackMetadata
} from '#/connection/channel-poster.ts'
import {
  APPROVAL_ACTIONS,
  LINK_ACTION_PREFIX
} from '#/connection/slack-connection.ts'
import type { SlackLines } from '#/prompts/slack.ts'
import type { PostedWait } from './worker-waits.ts'

export type WorkerThreadLink = { id: string; label: string; url: string }

const MAX_PLAN_TASKS = 50

const APPROVAL_EVENT = 'slack_approval'

const APPROVAL_TITLE_MAX_LENGTH = 150

const CONFIRM_TEXT_MAX_LENGTH = 300

const TASK_STATUS = {
  pending: 'pending',
  in_progress: 'in_progress',
  done: 'complete'
} as const

export function openingContent(
  line: string,
  links: readonly WorkerThreadLink[]
): SlackContent {
  const linkBlocks: SlackBlock[] =
    links.length === 0
      ? []
      : [
          {
            type: 'actions',
            elements: links.map(({ id, label, url }) => {
              return {
                type: 'button',
                action_id: `${LINK_ACTION_PREFIX}${id}`,
                text: { type: 'plain_text', text: label },
                url
              }
            })
          }
        ]

  return {
    text: line,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: line } },
      ...linkBlocks
    ]
  }
}

export function planContent(
  todos: readonly Todo[],
  lines: SlackLines
): SlackContent {
  const done = todos.filter(({ status }) => {
    return status === 'done'
  })

  return {
    text: lines.planProgress({ done: done.length, total: todos.length }),
    blocks: [
      {
        type: 'plan',
        title: lines.planTitle,
        tasks: todos.slice(0, MAX_PLAN_TASKS).map(({ text, status }, index) => {
          return {
            task_id: `step-${index + 1}`,
            title: text,
            status: TASK_STATUS[status]
          }
        })
      }
    ]
  }
}

function approvalSection(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } }
}

type ApprovalContentParams = {
  worker: string
  approvals: readonly PostedWait[]
  approvers: readonly string[]
  lines: SlackLines
}

export function approvalContent({
  worker,
  approvals,
  approvers,
  lines
}: ApprovalContentParams): SlackContent & { metadata: SlackMetadata } {
  const waitId = approvals[0]?.waitId ?? ''
  const calls = approvals
    .map(({ text }) => {
      return text
    })
    .join('\n')
  const text = `${lines.approvalQuestion}\n\`\`\`\n${calls}\n\`\`\``
  const visibleToUserIds = [...approvers]

  return {
    text,
    blocks: [
      approvalSection(text),
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            action_id: APPROVAL_ACTIONS.once,
            text: { type: 'plain_text', text: lines.approve },
            style: 'primary',
            value: waitId,
            visible_to_user_ids: visibleToUserIds,
            confirm: {
              title: { type: 'plain_text', text: lines.approveConfirmation },
              text: {
                type: 'plain_text',
                text: calls.slice(0, CONFIRM_TEXT_MAX_LENGTH)
              },
              confirm: { type: 'plain_text', text: lines.approve },
              deny: { type: 'plain_text', text: lines.cancel }
            }
          },
          {
            type: 'button',
            action_id: APPROVAL_ACTIONS.reject,
            text: { type: 'plain_text', text: lines.reject },
            style: 'danger',
            value: waitId,
            visible_to_user_ids: visibleToUserIds
          }
        ]
      }
    ],
    metadata: {
      event_type: APPROVAL_EVENT,
      event_payload: {
        approval_type: 'tool_use',
        title: lines
          .approvalTitle({ worker, call: approvals[0]?.text ?? '' })
          .slice(0, APPROVAL_TITLE_MAX_LENGTH),
        source: { ref_id: waitId },
        urgency: 'normal',
        options: { approve_label: lines.approve, deny_label: lines.reject }
      }
    }
  }
}

type DecidedContentParams = {
  asked: string
  answer: WorkerApproval['answer']
  user: string
  lines: SlackLines
}

export function decidedContent({
  asked,
  answer,
  user,
  lines
}: DecidedContentParams): SlackContent {
  const decision = `<@${user}> ${lines.decisions[answer]}`

  return {
    text: `${asked}\n${decision}`,
    blocks: [
      approvalSection(asked),
      { type: 'context', elements: [{ type: 'mrkdwn', text: decision }] }
    ]
  }
}
