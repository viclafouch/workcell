import { z } from 'zod'
import { toolDefinition } from '@tanstack/ai'
import { definePlugin } from '@tanstack/ai-harness'
import { FILE_TOOL_TEXT } from '#/prompts/files.ts'
import { FILE_EVENT, fileEventValue } from './file-event.ts'

const FILE_PLUGIN = 'workcell/chat-files'

export const SEND_FILE_TOOL = 'send_file'

const FILE_NAME = /^[^/\\]+\.[A-Za-z0-9]+$/u

const sendFileInputSchema = z.object({
  name: z.string().regex(FILE_NAME).describe(FILE_TOOL_TEXT.name),
  content: z.string().describe(FILE_TOOL_TEXT.content)
})

export function chatFiles() {
  const sendFile = toolDefinition({
    name: SEND_FILE_TOOL,
    description: FILE_TOOL_TEXT.description,
    inputSchema: sendFileInputSchema
  }).server(({ name, content }, context) => {
    context?.emitCustomEvent(FILE_EVENT, fileEventValue({ name, content }))

    return FILE_TOOL_TEXT.sent(name)
  })

  return definePlugin({
    name: FILE_PLUGIN,
    lifetime: 'host',
    setup: () => {
      return { tools: [sendFile] }
    }
  })
}
