import type { WorkerApproval } from '@workcell/core'

export type PlanProgress = { done: number; total: number }

export type ApprovalTitle = { worker: string; call: string }

export type SlackLines = {
  stoppedTurn: string
  failedTurn: string
  settledApproval: string
  noWorkerInThread: string
  greeting: (title: string) => string
  planTitle: string
  planProgress: (progress: PlanProgress) => string
  approvalQuestion: string
  approvalTitle: (approval: ApprovalTitle) => string
  approve: string
  approveConfirmation: string
  reject: string
  cancel: string
  decisions: Record<WorkerApproval['answer'], string>
}

export const SLACK_LINES: SlackLines = {
  stoppedTurn: 'Stopped.',
  failedTurn: 'An error stopped me. The host logs say which one.',
  settledApproval: 'This approval is settled already.',
  noWorkerInThread: 'No worker runs in this thread.',
  greeting: (title) => {
    return `Hi, ${title} here.`
  },
  planTitle: 'Steps',
  planProgress: ({ done, total }) => {
    return `Steps: ${done} of ${total} done.`
  },
  approvalQuestion: 'May I run this?',
  approvalTitle: ({ worker, call }) => {
    return `${worker}: ${call}`
  },
  approve: 'Approve',
  approveConfirmation: 'Approve?',
  reject: 'Reject',
  cancel: 'Cancel',
  decisions: { once: 'approved', reject: 'rejected' }
}

export function threadOpeningPrompt(taskName: string, task: string) {
  return `Write the first message of your Slack thread: one short line that says you take ${taskName}, and what you are going to change, in your own words.\nYour task: ${task}\nReply with the line only.`
}
