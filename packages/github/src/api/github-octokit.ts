import { Octokit } from '@octokit/core'
import { paginateGraphQL } from '@octokit/plugin-paginate-graphql'
import { paginateRest } from '@octokit/plugin-paginate-rest'
import { retry } from '@octokit/plugin-retry'
import { throttling } from '@octokit/plugin-throttling'
import { RequestError } from '@octokit/request-error'

const MAX_RATE_LIMIT_WAIT_SECONDS = 60

// oxlint-disable-next-line max-params -- the throttling plugin calls a limit handler with four arguments
function retryOnceAfterAShortWait(
  retryAfter: number,
  _options: unknown,
  _octokit: unknown,
  retryCount: number
) {
  return retryCount === 0 && retryAfter <= MAX_RATE_LIMIT_WAIT_SECONDS
}

const rateLimitHandlers = {
  onRateLimit: retryOnceAfterAShortWait,
  onSecondaryRateLimit: retryOnceAfterAShortWait
}

export const GithubOctokit = Octokit.plugin(
  throttling,
  retry,
  paginateRest,
  paginateGraphQL
).defaults({ throttle: rateLimitHandlers })

export type GithubOctokit = InstanceType<typeof GithubOctokit>

export function splitRepository(repository: string) {
  const [owner, repo] = repository.split('/')

  if (owner === undefined || repo === undefined) {
    throw new Error(`The repository ${repository} is not owner/name.`)
  }

  return { owner, repo }
}

export async function undefinedOnStatus<Answer>(
  status: number,
  request: Promise<Answer>
) {
  try {
    return await request
  } catch (error) {
    if (error instanceof RequestError && error.status === status) {
      return
    }

    throw error
  }
}
