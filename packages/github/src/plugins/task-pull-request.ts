import { definePlugin } from '@tanstack/ai-harness'
import { TaskFacts } from '@workcell/core'
import { pullRequestFact } from '#/prompts/github.ts'
import { taskPullRequestSchema } from '#/pull-requests/pull-request-url.ts'

export const taskPullRequest = definePlugin({
  name: 'workcell/github-task-pull-request',
  metadataSchema: taskPullRequestSchema,
  setup: () => {
    return {
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
