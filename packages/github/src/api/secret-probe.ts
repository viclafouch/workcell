import { Octokit } from '@octokit/core'
import { RequestError } from '@octokit/request-error'
import {
  PROBE_TIMEOUT_MS,
  type ProbeVerdict,
  type SecretProbe
} from '@workcell/core'
import { splitRepository } from './github-octokit.ts'

async function workflowRunsVerdict(
  octokit: Octokit,
  repository: string
): Promise<ProbeVerdict> {
  try {
    await octokit.request('GET /repos/{owner}/{repo}/actions/runs', {
      ...splitRepository(repository),
      per_page: 1,
      request: { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }
    })

    return 'accepted'
  } catch (error) {
    return error instanceof RequestError && error.response !== undefined
      ? 'refused'
      : 'unreachable'
  }
}

export function githubProbe(repositories: readonly string[]): SecretProbe {
  return {
    service: `GitHub, on the workflow runs of ${repositories.join(', ')},`,
    probe: async (token) => {
      const octokit = new Octokit({ auth: token })
      const verdicts = await Promise.all(
        repositories.map((repository) => {
          return workflowRunsVerdict(octokit, repository)
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
