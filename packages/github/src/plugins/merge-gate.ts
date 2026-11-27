import { z } from 'zod'
import type { ChatMiddleware } from '@tanstack/ai'
import { definePlugin } from '@tanstack/ai-harness'
import { workerMetadataSchema } from '@workcell/core'
import { MERGE_GATE_REFUSAL } from '#/prompts/github.ts'
import { mergeMetadataSchema } from '#/pull-requests/merge-metadata.ts'

const MERGE_GATE = 'workcell/github-merge-gate'

const SEGMENT_SEPARATORS = /&&|\|\||[;|\n]/u

const commandArgsSchema = z.object({ command: z.string() })

const FAILED_RUN = /^exit code: (?<code>\d+)\n(?<output>[\s\S]*)$/u

const STDERR_MARK = 'stderr:\n'

function failureOf(result: unknown) {
  const run = typeof result === 'string' ? FAILED_RUN.exec(result) : null
  const output = run?.groups?.output ?? ''

  if (run?.groups?.code === undefined || run.groups.code === '0') {
    return
  }

  const stderrAt = output.indexOf(STDERR_MARK)

  return (
    stderrAt === -1 ? output : output.slice(stderrAt + STDERR_MARK.length)
  ).trim()
}

function commandOf(text: string) {
  try {
    return commandArgsSchema.safeParse(JSON.parse(text)).data?.command
  } catch {
    return null
  }
}

const mergeGateMetadataSchema = workerMetadataSchema.extend(
  mergeMetadataSchema.shape
)

const QUOTES = /^['"]+|['"]+$/gu

function programOf(word: string) {
  return word.replaceAll(QUOTES, '').split('/').at(-1)
}

function isGithubMerge(segment: string) {
  const words = segment.trim().split(/\s+/u).map(programOf)
  const fromGh = words.slice(words.indexOf('gh'))

  return (
    words.includes('gh') && fromGh.includes('pr') && fromGh.includes('merge')
  )
}

function mergesOnGithub(command: string) {
  return command.split(SEGMENT_SEPARATORS).some(isGithubMerge)
}

export const pullRequestMergeGate = definePlugin({
  name: MERGE_GATE,
  metadataSchema: mergeGateMetadataSchema,
  setup: (context) => {
    const recordedCommand = async () => {
      const entry = await context.session.indexEntry()

      return mergeGateMetadataSchema.safeParse(entry?.metadata).data
        ?.mergeCommand
    }

    const guard: ChatMiddleware = {
      name: MERGE_GATE,
      onGuardToolCall: async (_ctx, { toolName, args }) => {
        const command = commandArgsSchema.safeParse(args).data?.command

        if (
          toolName !== 'bash' ||
          command === undefined ||
          !mergesOnGithub(command)
        ) {
          return
        }

        return command === (await recordedCommand())
          ? undefined
          : { type: 'skip', result: { error: MERGE_GATE_REFUSAL } }
      },
      onAfterToolCall: async (_ctx, { toolName, toolCall, result }) => {
        const mergeRefusal = failureOf(result)
        const recorded = await recordedCommand()

        if (
          toolName !== 'bash' ||
          mergeRefusal === undefined ||
          recorded === undefined ||
          commandOf(toolCall.function.arguments) !== recorded
        ) {
          return
        }

        await context.session.updateIndexEntry((current) => {
          return current.metadata === undefined
            ? {}
            : { metadata: { ...current.metadata, mergeRefusal } }
        })
      }
    }

    return { middleware: [guard] }
  }
})
