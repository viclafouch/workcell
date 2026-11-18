import { readFile } from 'node:fs/promises'
import { definePlugin } from '@tanstack/ai-harness'
import { agentMetadataSchema } from '#/session/metadata.ts'

const INSTRUCTION_FILES = 'workcell/instruction-files'

type InstructionFilesParams = {
  files: readonly string[]
  repositories?: Readonly<Record<string, string>>
}

export function instructionFiles({
  files,
  repositories = {}
}: InstructionFilesParams) {
  return definePlugin({
    name: INSTRUCTION_FILES,
    metadataSchema: agentMetadataSchema,
    setup: (setupContext) => {
      let texts: string[] = []
      let repositoryText = ''

      return {
        onTurnStart: async () => {
          const entry = await setupContext.session.indexEntry()
          const repositoryFile = repositories[entry?.metadata?.repository ?? '']
          const [read, repositoryRead] = await Promise.all([
            Promise.all(
              files.map((file) => {
                return readFile(file, 'utf8')
              })
            ),
            repositoryFile === undefined ? '' : readFile(repositoryFile, 'utf8')
          ])
          texts = read
          repositoryText = repositoryRead
        },
        prompts: [
          ...files.map((file, index) => {
            return {
              id: `${INSTRUCTION_FILES}/${index}`,
              text: () => {
                return texts[index] ?? ''
              }
            }
          }),
          {
            id: `${INSTRUCTION_FILES}/repository`,
            text: () => {
              return repositoryText
            }
          }
        ]
      }
    }
  })
}
