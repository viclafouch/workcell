import { z } from 'zod'
import { toolDefinition } from '@tanstack/ai'
import { definePlugin, PermissionRules } from '@tanstack/ai-harness'
import { workerMetadataSchema } from '@workcell/core'
import type { PullRequestHeadRef } from '#/github-api.ts'
import type { GithubReader } from '#/github-reader.ts'
import {
  REPLY_TOOL_NAME,
  RESOLVE_TOOL_NAME,
  REVIEW_THREADS_TEXT,
  REVIEW_THREADS_TOOL_NAME
} from '#/prompts/github.ts'
import type { ReviewThreadWriter } from '#/review-thread-writer.ts'

type ReviewThreadToolsParams = {
  reader: GithubReader
  writer: ReviewThreadWriter
}

const threadInputSchema = z.object({
  threadId: z.string().min(1).describe(REVIEW_THREADS_TEXT.threadId)
})

const replyInputSchema = threadInputSchema.extend({
  body: z.string().min(1).describe(REVIEW_THREADS_TEXT.body)
})

export function reviewThreadTools({ reader, writer }: ReviewThreadToolsParams) {
  return definePlugin({
    name: 'workcell/github-review-threads',
    metadataSchema: workerMetadataSchema,
    setup: (context) => {
      const onBranch = <Input, Output>(
        act: (head: PullRequestHeadRef, input: Input) => Promise<Output>
      ) => {
        return async (input: Input) => {
          const entry = await context.session.indexEntry()
          const repository = entry?.metadata?.repository
          const branch = entry?.metadata?.branch

          return repository === undefined || branch === undefined
            ? REVIEW_THREADS_TEXT.noBranch
            : act({ repository, branch }, input)
        }
      }

      return {
        tools: [
          toolDefinition({
            name: REVIEW_THREADS_TOOL_NAME,
            description: REVIEW_THREADS_TEXT.description,
            replay: 'safe'
          }).server(onBranch(reader.readReviewThreads)),
          toolDefinition({
            name: REPLY_TOOL_NAME,
            description: REVIEW_THREADS_TEXT.reply,
            inputSchema: replyInputSchema
          }).server(
            onBranch((head, input: z.infer<typeof replyInputSchema>) => {
              return writer.reply({ ...head, ...input })
            })
          ),
          toolDefinition({
            name: RESOLVE_TOOL_NAME,
            description: REVIEW_THREADS_TEXT.resolve,
            replay: 'safe',
            inputSchema: threadInputSchema
          }).server(
            onBranch((head, input: z.infer<typeof threadInputSchema>) => {
              return writer.resolve({ ...head, ...input })
            })
          )
        ],
        contribute: [
          PermissionRules.item({
            tool: REVIEW_THREADS_TOOL_NAME,
            decision: 'allow',
            kind: 'read'
          }),
          ...[REPLY_TOOL_NAME, RESOLVE_TOOL_NAME].map((tool) => {
            return PermissionRules.item({
              tool,
              decision: 'allow',
              kind: 'execute'
            })
          })
        ]
      }
    }
  })
}
