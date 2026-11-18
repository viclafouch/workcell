import { readFile } from 'node:fs/promises'
import { definePlugin } from '@tanstack/ai-harness'
import { CHAT_PRESENCE_RULE } from '#/prompts/voice.ts'

const VOICE_PLUGIN = 'workcell/chat-voice'

type ChatVoiceParams = { file: string }

export function readVoice(file: string) {
  return readFile(file, 'utf8')
}

export function chatVoice({ file }: ChatVoiceParams) {
  return definePlugin({
    name: VOICE_PLUGIN,
    lifetime: 'turn',
    setup: async () => {
      return {
        prompts: [
          {
            id: VOICE_PLUGIN,
            text: `${CHAT_PRESENCE_RULE}\n\n${await readVoice(file)}`
          }
        ]
      }
    }
  })
}
