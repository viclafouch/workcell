import type { WorkerApproval } from '@workcell/core'

export type PlanProgress = { done: number; total: number }

export type ChatLines = {
  stoppedTurn: string
  failedTurn: string
  settledApproval: string
  noWorkerInThread: string
  greeting: (title: string) => string
  starting: (taskName: string) => string
  queuedName: (name: string) => string
  planTitle: string
  planProgress: (progress: PlanProgress) => string
  approvalQuestion: string
  approve: string
  reject: string
  stop: string
  decisions: Record<WorkerApproval['answer'], string>
}

export const CHAT_LINES: ChatLines = {
  stoppedTurn: 'Stopped.',
  failedTurn: 'An error stopped me. The host logs say which one.',
  settledApproval: 'This approval is settled already.',
  noWorkerInThread: 'No worker runs in this thread.',
  greeting: (title) => {
    return `Hi, ${title} here.`
  },
  starting: (taskName) => {
    return `I take ${taskName}. My sandbox is getting ready.`
  },
  queuedName: (name) => {
    return `${name} (queued)`
  },
  planTitle: 'Steps',
  planProgress: ({ done, total }) => {
    return `Steps: ${done} of ${total} done.`
  },
  approvalQuestion: 'May I run this?',
  approve: 'Approve',
  reject: 'Reject',
  stop: 'Stop',
  decisions: { once: 'approved', reject: 'rejected' }
}
