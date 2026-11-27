import { z } from 'zod'
import type { ChatMiddleware } from '@tanstack/ai'
import { definePlugin } from '@tanstack/ai-harness'
import { workerMetadataSchema } from '@workcell/core'
import { mergeGateRefusal } from '#/prompts/github.ts'
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

const REDIRECTION = /^\d*(?:>>?|<|>&|&>)/u

const BARE_REDIRECTION = /^\d*(?:>>?|<|&>)$/u

function wordsOf(segment: string) {
  return segment
    .trim()
    .split(/\s+/u)
    .map((word) => {
      return word.replaceAll(QUOTES, '')
    })
}

function commandWordsOf(segment: string) {
  const words = wordsOf(segment)

  return words.filter((word, index) => {
    const previous = words[index - 1] ?? ''

    return !REDIRECTION.test(word) && !BARE_REDIRECTION.test(previous)
  })
}

function programOf(word: string) {
  return word.split('/').at(-1)
}

function isGithubMerge(segment: string) {
  const programs = wordsOf(segment).map(programOf)
  const fromGh = programs.slice(programs.indexOf('gh'))

  return (
    programs.includes('gh') && fromGh.includes('pr') && fromGh.includes('merge')
  )
}

function isRecordedMerge(segment: string, recorded: string) {
  return (
    commandWordsOf(segment).join(' ') === commandWordsOf(recorded).join(' ')
  )
}

function mergeSegmentsOf(command: string) {
  return command.split(SEGMENT_SEPARATORS).filter(isGithubMerge)
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
        const merges =
          toolName === 'bash' && command !== undefined
            ? mergeSegmentsOf(command)
            : []

        if (merges.length === 0) {
          return
        }

        const recorded = await recordedCommand()
        const isTheRecordedMerge = merges.every((segment) => {
          return recorded !== undefined && isRecordedMerge(segment, recorded)
        })

        return isTheRecordedMerge
          ? undefined
          : { type: 'skip', result: { error: mergeGateRefusal(recorded) } }
      },
      onAfterToolCall: async (_ctx, { toolName, toolCall, result }) => {
        const mergeRefusal = failureOf(result)
        const recorded = await recordedCommand()
        const merges = mergeSegmentsOf(
          commandOf(toolCall.function.arguments) ?? ''
        )

        if (
          toolName !== 'bash' ||
          mergeRefusal === undefined ||
          recorded === undefined ||
          merges.length === 0
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
