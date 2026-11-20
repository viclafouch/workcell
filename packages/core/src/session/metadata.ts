import { z } from 'zod'

export const workerMetadataSchema = z.looseObject({
  name: z.string(),
  task: z.string(),
  entrySkill: z.string().optional(),
  repository: z.string(),
  subject: z.string().optional(),
  branch: z.string().optional(),
  inputId: z.string().optional(),
  report: z.string().optional(),
  startupMs: z.number().optional()
})

export type WorkerMetadata = z.infer<typeof workerMetadataSchema>

export const agentMetadataSchema = workerMetadataSchema.partial()

export type AgentMetadata = z.infer<typeof agentMetadataSchema>
