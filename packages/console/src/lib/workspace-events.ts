import { createPluginEvent } from '@tanstack/ai-harness'
import type { FileChange } from '@tanstack/ai-harness/plugins/coding'
import type { WorkerSandboxSetupEvent } from '@workcell/core'

export type { FileChange }

export const FileChanged = createPluginEvent<FileChange>(
  'tanstack/workspace-tools:file-changed'
)

export const JobStarted = createPluginEvent<{ jobId: string; command: string }>(
  'tanstack/workspace-tools:job-started'
)

export const JobOutput = createPluginEvent<{ jobId: string; output: string }>(
  'tanstack/workspace-tools:job-output'
)

export const JobEnded = createPluginEvent<{ jobId: string; exitCode: number }>(
  'tanstack/workspace-tools:job-ended'
)

export const WorkerSandboxSetup = createPluginEvent<WorkerSandboxSetupEvent>(
  'workcell/worker-sandbox:setup'
)

export const TODOS_PLUGIN = 'tanstack/todos'

export const FEEDBACK_PLUGIN = 'workcell/feedback'
