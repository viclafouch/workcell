import { definePlugin } from '@tanstack/ai-harness'
import { TaskFacts, workerMetadataSchema } from '@workcell/core'
import { pullRequestFact } from '#/prompts/github.ts'

export const taskPullRequest = definePlugin({
  name: 'workcell/github-task-pull-request',
  metadataSchema: workerMetadataSchema,
  setup: () => {
    return {
      contribute: [
        TaskFacts.item((metadata) => {
          const { pullRequest } = workerMetadataSchema.parse(metadata)

          return pullRequest === undefined
            ? undefined
            : pullRequestFact(pullRequest)
        })
      ]
    }
  }
})
