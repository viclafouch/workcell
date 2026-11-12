import { readFile } from 'node:fs/promises'
import { definePlugin } from '@tanstack/ai-harness'

const VOICE_PLUGIN = 'workcell/slack-voice'

type SlackVoiceParams = { file: string }

export function readVoice(file: string) {
  return readFile(file, 'utf8')
}

export function slackVoice({ file }: SlackVoiceParams) {
  return definePlugin({
    name: VOICE_PLUGIN,
    lifetime: 'turn',
    setup: async () => {
      return { prompts: [{ id: VOICE_PLUGIN, text: await readVoice(file) }] }
    }
  })
}
