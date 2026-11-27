import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PullRequestDetails, PullRequests } from '@workcell/core'

const pullRequestInputSchema = z.object({
  url: z.url(),
  revision: z.string().optional()
})

export type PullRequestRead =
  | { pullRequest: PullRequestDetails | null }
  | { failure: string }

type SharedRead<Value> = {
  revision: string | undefined
  value: Promise<Value>
}

const sharedReads = <Value>(read: (url: string) => Promise<Value>) => {
  const latest = new Map<string, SharedRead<Value>>()

  const readForgettingFailures = async (
    url: string,
    revision: string | undefined
  ) => {
    try {
      return await read(url)
    } catch (error) {
      if (latest.get(url)?.revision === revision) {
        latest.delete(url)
      }

      throw error
    }
  }

  return (url: string, revision: string | undefined) => {
    const known = latest.get(url)

    if (known !== undefined && known.revision === revision) {
      return known.value
    }

    const value = readForgettingFailures(url, revision)
    latest.set(url, { revision, value })

    return value
  }
}

const readsBySource = new WeakMap<
  PullRequests,
  {
    read: ReturnType<typeof sharedReads<PullRequestDetails | null>>
    diff: ReturnType<typeof sharedReads<string | null>>
  }
>()

const readsOf = (pullRequests: PullRequests) => {
  const known = readsBySource.get(pullRequests)

  if (known !== undefined) {
    return known
  }

  const reads = {
    read: sharedReads(pullRequests.read),
    diff: sharedReads(pullRequests.diff)
  }
  readsBySource.set(pullRequests, reads)

  return reads
}

export const getPullRequest = createServerFn({ method: 'GET' })
  .validator(pullRequestInputSchema)
  .handler(async ({ context, data }): Promise<PullRequestRead | null> => {
    if (context.pullRequests === undefined) {
      return null
    }

    try {
      return {
        pullRequest: await readsOf(context.pullRequests).read(
          data.url,
          data.revision
        )
      }
    } catch (error) {
      context.logger.error(
        { error, pullRequest: data.url },
        'The code host gave no pull request.'
      )

      return { failure: Error.isError(error) ? error.message : String(error) }
    }
  })

export const getPullRequestDiff = createServerFn({ method: 'GET' })
  .validator(pullRequestInputSchema)
  .handler(async ({ context, data }) => {
    return context.pullRequests === undefined
      ? null
      : readsOf(context.pullRequests).diff(data.url, data.revision)
  })
