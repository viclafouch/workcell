const BYTES_PER_MEGABYTE = 1_048_576

export const MESSAGE_FILES_TEXT = {
  file: (name: string, mimeType: string, content: string) => {
    return `<file name=${JSON.stringify(name)} type=${JSON.stringify(mimeType)}>\n${content}\n</file>`
  },
  truncated: (shown: number, total: number) => {
    return `[The file goes on: you got the first ${shown} of ${total} characters.]`
  },
  notRead: (lines: readonly string[]) => {
    return `The person attached files that you did not get. Tell them which ones and why, then answer from what you got:\n${lines.join('\n')}`
  },
  notReadLine: (name: string, mimeType: string, reason: string) => {
    return `- ${name} (${mimeType}): ${reason}`
  },
  reasons: {
    refused: 'the project does not read this type of file',
    noReader: 'no reader exists for this type of file',
    model: (kind: string) => {
      return `the model does not read ${kind} files`
    },
    tooBig: (maxBytes: number) => {
      return `bigger than the limit of ${Math.round(maxBytes / BYTES_PER_MEGABYTE)} MB`
    },
    download: 'the download failed',
    notText: 'its text is not valid UTF-8'
  }
} as const
