import type { FileUpload } from 'chat'
import type { SentFile, SentFileStore } from '@workcell/core'

export type SentFileSource = Pick<SentFileStore, 'take'>

export async function takeUploads(
  sentFiles: SentFileSource | undefined,
  files: readonly SentFile[]
): Promise<FileUpload[]> {
  if (sentFiles === undefined) {
    return []
  }

  const taken = await Promise.all(
    files.map(async ({ key, name }) => {
      const bytes = await sentFiles.take(key)

      return bytes === null
        ? []
        : [{ filename: name, data: Buffer.from(bytes) }]
    })
  )

  return taken.flat()
}
