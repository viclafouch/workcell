import { z } from 'zod'

export const mergeMetadataSchema = z.object({
  mergeCommand: z.string().optional(),
  mergeRefusal: z.string().optional()
})
