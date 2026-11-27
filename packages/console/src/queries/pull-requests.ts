import { queryOptions } from '@tanstack/react-query'
import {
  getPullRequest,
  getPullRequestDiff
} from '#/server/pull-requests.functions.ts'

const pullRequestKey = (url: string, revision: string | undefined) => {
  return ['pull-request', url, revision ?? null] as const
}

export const getPullRequestQueryOpts = (
  url: string,
  revision: string | undefined
) => {
  return queryOptions({
    queryKey: pullRequestKey(url, revision),
    queryFn: () => {
      return getPullRequest({ data: { url, revision } })
    },
    staleTime: Infinity
  })
}

export const getPullRequestDiffQueryOpts = (
  url: string,
  revision: string | undefined
) => {
  return queryOptions({
    queryKey: [...pullRequestKey(url, revision), 'diff'],
    queryFn: () => {
      return getPullRequestDiff({ data: { url, revision } })
    },
    staleTime: Infinity,
    enabled: false
  })
}
