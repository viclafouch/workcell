import { z } from 'zod'

export const taskOutcomeSchema = z.object({
  value: z.enum(['success', 'flawed', 'blocked', 'manual']),
  cause: z.string().optional(),
  costUsd: z.number(),
  changedAt: z.number()
})

export type TaskOutcome = z.infer<typeof taskOutcomeSchema>

export type TaskEnd = Pick<TaskOutcome, 'value' | 'cause'>

export const workerMetadataSchema = z.looseObject({
  name: z.string(),
  task: z.string(),
  entrySkill: z.string().optional(),
  repository: z.string(),
  subject: z.string().optional(),
  branch: z.string().optional(),
  pullRequest: z.string().optional(),
  inputId: z.string().optional(),
  report: z.string().optional(),
  startupMs: z.number().optional(),
  outcome: taskOutcomeSchema.optional()
})

export type WorkerMetadata = z.infer<typeof workerMetadataSchema>

export const agentMetadataSchema = workerMetadataSchema.partial()

export type AgentMetadata = z.infer<typeof agentMetadataSchema>
