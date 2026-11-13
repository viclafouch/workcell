import { definePlugin } from '@tanstack/ai-harness'
import { FinishRefusals } from '@workcell/core'
import type { GithubReader } from '#/github-reader.ts'
import { openPullRequestRefusal } from '#/prompts/github.ts'

export function refuseFinishWithAnOpenPullRequest(reader: GithubReader) {
  return definePlugin({
    name: 'workcell/github-finish-refusals',
    setup: () => {
      return {
        contribute: [
          FinishRefusals.item(async ({ repository, branch }) => {
            if (branch === undefined) {
              return
            }

            const pullRequest = await reader.openPullRequestUrl({
              repository,
              branch
            })

            return pullRequest === undefined
              ? undefined
              : openPullRequestRefusal(pullRequest)
          })
        ]
      }
    }
  })
}
