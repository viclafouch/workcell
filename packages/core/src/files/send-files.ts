import { z } from 'zod'
import { toolDefinition } from '@tanstack/ai'
import { definePlugin } from '@tanstack/ai-harness'
import { SEND_FILE_TEXT } from '#/prompts/send-files.ts'
import type { SentFileStore } from '#/store/sent-file-store.ts'

const SEND_FILES_PLUGIN = 'workcell/send-files'

export const SEND_FILE_TOOL = 'send_file'

export const SENT_FILE_EVENT = 'workcell.sent-file'

export const SENT_FILE_MAX_BYTES = 52_428_800

const FILE_NAME = /^[^/\\]+\.[A-Za-z0-9]+$/u

const sentFileSchema = z.object({ key: z.string(), name: z.string() })

export type SentFile = z.infer<typeof sentFileSchema>

export function sentFileOfEvent(value: unknown) {
  return sentFileSchema.safeParse(value).data
}

const sendFileInputSchema = z
  .object({
    name: z.string().regex(FILE_NAME).describe(SEND_FILE_TEXT.name),
    content: z.string().optional().describe(SEND_FILE_TEXT.content),
    path: z.string().optional().describe(SEND_FILE_TEXT.path)
  })
  .refine(
    ({ content, path }) => {
      return (content === undefined) !== (path === undefined)
    },
    { message: SEND_FILE_TEXT.oneSource }
  )

export type ReadAgentFile = (
  threadId: string,
  path: string
) => Promise<Uint8Array>

type SendFilesParams = {
  sentFiles: Pick<SentFileStore, 'put'>
  readFile: ReadAgentFile
  secretValues: readonly string[]
}

function holdsSecret(bytes: Uint8Array, secretValues: readonly string[]) {
  const buffer = Buffer.from(bytes)

  return secretValues.some((value) => {
    return value !== '' && buffer.includes(value)
  })
}

export function sendFiles({
  sentFiles,
  readFile,
  secretValues
}: SendFilesParams) {
  return definePlugin({
    name: SEND_FILES_PLUGIN,
    setup: ({ session }) => {
      const sendFile = toolDefinition({
        name: SEND_FILE_TOOL,
        description: SEND_FILE_TEXT.description,
        inputSchema: sendFileInputSchema
      }).server(async ({ name, content, path = '' }, context) => {
        const bytes =
          content === undefined
            ? await readFile(session.threadId, path)
            : new TextEncoder().encode(content)

        if (bytes.byteLength > SENT_FILE_MAX_BYTES) {
          throw new Error(SEND_FILE_TEXT.tooBig(SENT_FILE_MAX_BYTES))
        }

        if (holdsSecret(bytes, secretValues)) {
          throw new Error(SEND_FILE_TEXT.holdsSecret)
        }

        const key = await sentFiles.put({
          threadId: session.threadId,
          name,
          bytes
        })
        context?.emitCustomEvent(SENT_FILE_EVENT, { key, name })

        return SEND_FILE_TEXT.sent(name)
      })

      return { tools: [sendFile] }
    }
  })
}
