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
  readingStatus: string
  setupStatus: string
  planTitle: string
  planProgress: (progress: PlanProgress) => string
  approvalQuestion: string
  approve: string
  reject: string
  stop: string
  decisions: Record<WorkerApproval['answer'], string>
  toolTask: (toolName: string) => string
}

const TOOL_TASKS = new Map([
  ['read_file', 'Reading a file'],
  ['list_files', 'Listing files'],
  ['grep', 'Searching the code'],
  ['bash', 'Running a command'],
  ['write_file', 'Writing a file'],
  ['edit_file', 'Editing a file'],
  ['webfetch', 'Reading a web page'],
  ['websearch', 'Searching the web'],
  ['todo_write', 'Updating the plan'],
  ['question', 'Asking a question'],
  ['send_feedback', 'Sending feedback'],
  ['list_workers', 'Checking the workers'],
  ['start_worker', 'Starting a worker'],
  ['message_worker', 'Messaging a worker'],
  ['stop_worker', 'Stopping a worker']
])

export const CHAT_LINES: ChatLines = {
  stoppedTurn: 'Stopped.',
  failedTurn: 'An error stopped me. The host logs say which one.',
  settledApproval: 'This approval is settled already.',
  noWorkerInThread: 'No worker runs in this thread.',
  greeting: (title) => {
    return `Hi, ${title} here.`
  },
  starting: (taskName) => {
    return `I take ${taskName}. Setting up.`
  },
  queuedName: (name) => {
    return `${name} (queued)`
  },
  readingStatus: 'Reading your message.',
  setupStatus: 'Setting up, it takes a few minutes.',
  planTitle: 'Steps',
  planProgress: ({ done, total }) => {
    return `Steps: ${done} of ${total} done.`
  },
  approvalQuestion: 'May I run this?',
  approve: 'Approve',
  reject: 'Reject',
  stop: 'Stop',
  decisions: { once: 'approved', reject: 'rejected' },
  toolTask: (toolName) => {
    return TOOL_TASKS.get(toolName) ?? 'Using a tool'
  }
}
