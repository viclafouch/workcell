import { z } from 'zod'
import { definePlugin } from '@tanstack/ai-harness'
import { TaskFacts, workerMetadataSchema } from '@workcell/core'
import { pullRequestFact } from '#/prompts/github.ts'

const pullRequestMetadataSchema = workerMetadataSchema.extend({
  pullRequest: z.string().optional()
})

export const pullRequestTaskFact = definePlugin({
  name: 'workcell/github-task-facts',
  setup: () => {
    return {
      contribute: [
        TaskFacts.item((metadata) => {
          const { pullRequest } = pullRequestMetadataSchema.parse(metadata)

          return pullRequest === undefined
            ? undefined
            : pullRequestFact(pullRequest)
        })
      ]
    }
  }
})
