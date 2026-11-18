import type { FileUpload } from 'chat'
import { z } from 'zod'

export const FILE_EVENT = 'workcell.file'

const fileEventSchema = z.object({ name: z.string(), content: z.string() })

export type SentFile = z.infer<typeof fileEventSchema>

export function fileEventValue(file: SentFile) {
  return file
}

export function fileOfEvent(value: unknown) {
  return fileEventSchema.safeParse(value).data
}

export function toFileUpload({ name, content }: SentFile): FileUpload {
  return { filename: name, data: Buffer.from(content, 'utf8') }
}
