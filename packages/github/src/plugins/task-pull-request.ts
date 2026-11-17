import { z } from 'zod'
import type { ChatMiddleware } from '@tanstack/ai'
import { definePlugin } from '@tanstack/ai-harness'
import { TaskFacts } from '@workcell/core'
import { pullRequestFact } from '#/prompts/github.ts'
import {
  pullRequestUrlPrefix,
  taskPullRequestSchema
} from '#/pull-requests/pull-request-url.ts'

const PLUGIN_NAME = 'workcell/github-task-pull-request'

const BASH_TOOL = 'bash'

const SUCCESS_REPORT = 'exit code: 0\n'

const CREATE_COMMAND = /(?:^|[;&|(\n])\s*gh\s+pr\s+create(?=\s|$)/u

const PULL_REQUEST_NUMBER = /^\d+$/u

const commandSchema = z.object({ command: z.string() })

type CreatedPullRequestUrlParams = {
  arguments: string
  result: unknown
  repository: string
}

function commandOf(toolArguments: string) {
  try {
    return commandSchema.parse(JSON.parse(toolArguments)).command
  } catch {
    return null
  }
}

function createdPullRequestUrl({
  arguments: toolArguments,
  result,
  repository
}: CreatedPullRequestUrlParams) {
  const command = commandOf(toolArguments)

  if (
    command === null ||
    !CREATE_COMMAND.test(command) ||
    typeof result !== 'string' ||
    !result.startsWith(SUCCESS_REPORT)
  ) {
    return
  }

  const prefix = pullRequestUrlPrefix(repository).toLowerCase()

  return result
    .split('\n')
    .map((line) => {
      return line.trim()
    })
    .find((line) => {
      return (
        line.toLowerCase().startsWith(prefix) &&
        PULL_REQUEST_NUMBER.test(line.slice(prefix.length))
      )
    })
}

export const taskPullRequest = definePlugin({
  name: PLUGIN_NAME,
  metadataSchema: taskPullRequestSchema,
  setup: (setupContext) => {
    const recordCreated: ChatMiddleware = {
      name: PLUGIN_NAME,
      onAfterToolCall: async (_ctx, { toolName, toolCall, ok, result }) => {
        if (!ok || toolName !== BASH_TOOL) {
          return
        }

        const entry = await setupContext.session.indexEntry()

        if (entry?.metadata === undefined) {
          return
        }

        const pullRequest = createdPullRequestUrl({
          arguments: toolCall.function.arguments,
          result,
          repository: entry.metadata.repository
        })

        if (
          pullRequest === undefined ||
          pullRequest === entry.metadata.pullRequest
        ) {
          return
        }

        await setupContext.session.updateIndexEntry((current) => {
          return current.metadata === undefined
            ? {}
            : { metadata: { ...current.metadata, pullRequest } }
        })
      }
    }

    return {
      middleware: [recordCreated],
      contribute: [
        TaskFacts.item((metadata) => {
          const { pullRequest } = taskPullRequestSchema.parse(metadata)

          return pullRequest === undefined
            ? undefined
            : pullRequestFact(pullRequest)
        })
      ]
    }
  }
})
