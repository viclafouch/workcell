import { bearer, requestVerdict, type SecretProbe } from '@workcell/core'
import { GITHUB_REST_URL } from './github-api.ts'

function workflowRunsVerdict(repository: string, token: string) {
  return requestVerdict(
    `${GITHUB_REST_URL}/repos/${repository}/actions/runs?per_page=1`,
    bearer(token)
  )
}

export function githubProbe(repositories: readonly string[]): SecretProbe {
  return {
    service: `GitHub, on the workflow runs of ${repositories.join(', ')},`,
    probe: async (token) => {
      const verdicts = await Promise.all(
        repositories.map((repository) => {
          return workflowRunsVerdict(repository, token)
        })
      )

      return (
        verdicts.find((verdict) => {
          return verdict !== 'accepted'
        }) ?? 'accepted'
      )
    }
  }
}
