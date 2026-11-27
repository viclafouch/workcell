import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import { getPullRequestQueryOpts } from '#/queries/pull-requests.ts'
import type { PullRequestRead as PullRequestReadResult } from '#/server/pull-requests.functions.ts'
import { PullRequestArticle } from './pull-request-article.tsx'

type PullRequestReadViewProps = {
  repository: string
  url: string
  revision: string | undefined
  read: PullRequestReadResult | null | undefined
}

const PullRequestReadView = ({
  repository,
  url,
  revision,
  read
}: PullRequestReadViewProps) => {
  if (read === undefined) {
    return (
      <div
        aria-busy
        aria-label="Loading the pull request"
        className="flex flex-col gap-3"
      >
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-24" />
      </div>
    )
  }

  if (read === null) {
    return (
      <p className="text-sm text-muted-foreground">
        This host reads no pull request: none of its integrations brings them.
      </p>
    )
  }

  if ('failure' in read) {
    return (
      <p role="alert" data-status="failed" className="text-sm text-status">
        The pull request did not load: {read.failure}
      </p>
    )
  }

  if (read.pullRequest === null) {
    return (
      <p className="text-sm text-muted-foreground">
        The pull request {url} is no longer there.
      </p>
    )
  }

  return (
    <PullRequestArticle
      pullRequest={read.pullRequest}
      repository={repository}
      revision={revision}
    />
  )
}

type PullRequestReadProps = {
  repository: string
  url: string
  revision: string | undefined
}

const PullRequestRead = ({
  repository,
  url,
  revision
}: PullRequestReadProps) => {
  const pullRequestQuery = useQuery({
    ...getPullRequestQueryOpts(url, revision),
    placeholderData: (previous) => {
      return previous
    }
  })

  if (pullRequestQuery.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        The host did not answer. The pull request reads again on its next
        change.
      </p>
    )
  }

  return (
    <PullRequestReadView
      repository={repository}
      url={url}
      revision={revision}
      read={pullRequestQuery.data}
    />
  )
}

type PullRequestPanelProps = {
  repository: string
  url: string | undefined
  revision: string | undefined
  branch: string | undefined
}

export const PullRequestPanel = ({
  repository,
  url,
  revision,
  branch
}: PullRequestPanelProps) => {
  if (url === undefined) {
    return (
      <p className="text-sm text-muted-foreground">
        {branch === undefined
          ? 'No pull request yet: the worker opens one once its change is ready.'
          : `No pull request yet: the worker opens one from ${branch} once its change is ready.`}
      </p>
    )
  }

  return (
    <PullRequestRead repository={repository} url={url} revision={revision} />
  )
}
