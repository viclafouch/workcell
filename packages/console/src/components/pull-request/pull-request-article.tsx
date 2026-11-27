import { cn } from 'cn'
import {
  ExternalLinkIcon,
  FileDiffIcon,
  GitBranchIcon,
  GitMergeIcon,
  MessageSquareIcon
} from 'lucide-react'
import type { PullRequestDetails } from '@workcell/core'
import { DescriptionDisclosure } from '#/components/markdown/description-disclosure.tsx'
import { PanelTab, PanelTabsList } from '#/components/tabs/panel-tabs.tsx'
import { MiddleTruncate } from '#/components/text/middle-truncate.tsx'
import { PersonLine } from '#/components/ticket/person-line.tsx'
import { TimeAgo } from '#/components/time/time-ago.tsx'
import { Tabs, TabsContent } from '#/components/ui/tabs.tsx'
import {
  checksSummaryOf,
  MERGE_STATUSES
} from '#/constants/pull-request-status.ts'
import { countOf, formatCount } from '#/lib/count-words.ts'
import { PullRequestChecks } from './pull-request-checks.tsx'
import { PullRequestFiles } from './pull-request-files.tsx'
import { PullRequestSidebar } from './pull-request-sidebar.tsx'
import { PullRequestStatePill } from './pull-request-state-pill.tsx'
import { SignalLine } from './signal-line.tsx'

const SHORT_COMMIT_LENGTH = 7

const DIFF_BLOCKS = 5

const RELATIVE_DAYS = 7

const BRANCH_TAIL = 16

type DiffStatProps = {
  additions: number
  deletions: number
}

const blockToneOf = (
  index: number,
  { additions, deletions }: DiffStatProps
) => {
  const total = additions + deletions

  if (total === 0) {
    return 'bg-muted'
  }

  return index < Math.round((additions / total) * DIFF_BLOCKS)
    ? 'bg-(--signal-success)'
    : 'bg-(--signal-danger)'
}

const DiffStat = ({ additions, deletions }: DiffStatProps) => {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 tabular text-label">
      <span data-signal="success" className="text-signal">
        +{formatCount(additions)}
      </span>
      <span data-signal="danger" className="text-signal">
        -{formatCount(deletions)}
      </span>
      <span aria-hidden className="flex gap-px">
        {Array.from({ length: DIFF_BLOCKS }, (_, index) => {
          return (
            <span
              key={index}
              className={cn(
                'size-2 rounded-sm',
                blockToneOf(index, { additions, deletions })
              )}
            />
          )
        })}
      </span>
    </span>
  )
}

type MergeLineProps = {
  pullRequest: PullRequestDetails
}

const MergeLine = ({ pullRequest }: MergeLineProps) => {
  const { merge, closedAt, base, mergeStatus } = pullRequest

  if (merge !== undefined) {
    return (
      <p
        data-signal="done"
        className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm"
      >
        <GitMergeIcon aria-hidden className="size-4 shrink-0 text-signal" />
        <span>
          Merged into {base}{' '}
          <TimeAgo
            value={Date.parse(merge.mergedAt)}
            recentLabel="just now"
            absoluteAfterDays={RELATIVE_DAYS}
          />
          {merge.mergedBy === undefined ? null : ` by ${merge.mergedBy.name}`}
        </span>
        {merge.commit === undefined ? null : (
          <span className="text-muted-foreground">
            as{' '}
            <code className="font-mono text-label">
              {merge.commit.slice(0, SHORT_COMMIT_LENGTH)}
            </code>
          </span>
        )}
      </p>
    )
  }

  if (closedAt !== undefined) {
    return (
      <p>
        <SignalLine signal="danger">
          Closed{' '}
          <TimeAgo
            value={Date.parse(closedAt)}
            recentLabel="just now"
            absoluteAfterDays={RELATIVE_DAYS}
          />{' '}
          without a merge
        </SignalLine>
      </p>
    )
  }

  if (mergeStatus === undefined) {
    return null
  }

  const { signal, label } = MERGE_STATUSES[mergeStatus]

  return (
    <p>
      <SignalLine signal={signal}>{label}</SignalLine>
    </p>
  )
}

type PullRequestArticleProps = {
  pullRequest: PullRequestDetails
  repository: string
  revision: string | undefined
}

export const PullRequestArticle = ({
  pullRequest,
  repository,
  revision
}: PullRequestArticleProps) => {
  const {
    key,
    title,
    url,
    author,
    updatedAt,
    commentCount,
    base,
    head,
    description,
    checks,
    hiddenChecks,
    fileCount
  } = pullRequest
  const checksSummary = checksSummaryOf(checks, hiddenChecks)

  return (
    <article aria-label={`Pull request ${key}`} className="flex flex-col gap-4">
      <header className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <span className="truncate">{repository}</span>
            <span className="shrink-0 font-semibold text-foreground">
              {key}
            </span>
            <ExternalLinkIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <span className="flex shrink-0 items-center gap-2.5">
            {commentCount === 0 ? null : (
              <span className="inline-flex items-center gap-1 text-label text-muted-foreground">
                <MessageSquareIcon aria-hidden className="size-3.5" />
                <span className="tabular">{formatCount(commentCount)}</span>
                <span className="sr-only">
                  {commentCount === 1 ? 'comment' : 'comments'}
                </span>
              </span>
            )}
            <PullRequestStatePill pullRequest={pullRequest} />
          </span>
        </div>
        <h2
          dir="auto"
          className="text-lg leading-snug font-semibold text-pretty break-words"
        >
          {title}
        </h2>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-muted-foreground">
          {author === undefined ? null : (
            <PersonLine name={author.name} avatarUrl={author.avatarUrl} />
          )}
          <span className="whitespace-nowrap">
            updated{' '}
            <TimeAgo
              value={Date.parse(updatedAt)}
              recentLabel="just now"
              absoluteAfterDays={RELATIVE_DAYS}
            />
          </span>
          <span className="whitespace-nowrap">
            {countOf(pullRequest.commitCount, 'commit', 'commits')}
          </span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <FileDiffIcon aria-hidden className="size-3.5" />
            {countOf(fileCount, 'file', 'files')}
          </span>
          <DiffStat
            additions={pullRequest.additions}
            deletions={pullRequest.deletions}
          />
        </p>
        <p className="flex min-w-0 items-center gap-1.5 font-mono text-label text-muted-foreground">
          <GitBranchIcon aria-hidden className="size-3.5 shrink-0" />
          <MiddleTruncate
            text={base}
            tail={BRANCH_TAIL}
            className="max-w-2/5"
          />
          <span aria-label="receives the changes of" className="shrink-0">
            ←
          </span>
          <MiddleTruncate text={head} tail={BRANCH_TAIL} className="flex-1" />
        </p>
        <MergeLine pullRequest={pullRequest} />
      </header>
      <Tabs defaultValue="summary" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <PanelTabsList
            label="Parts of the pull request"
            variant="underline"
            className="w-auto min-w-0 flex-1"
          >
            <PanelTab value="summary">Summary</PanelTab>
            <PanelTab value="checks" count={checks.length}>
              Checks
            </PanelTab>
            <PanelTab value="files" count={fileCount}>
              Files
            </PanelTab>
          </PanelTabsList>
          <SignalLine signal={checksSummary.signal}>
            {checksSummary.label}
          </SignalLine>
        </div>
        <TabsContent value="summary" className="flex flex-col gap-5">
          <PullRequestSidebar pullRequest={pullRequest} />
          <DescriptionDisclosure
            text={description}
            empty="The pull request has no description."
          />
        </TabsContent>
        <TabsContent value="checks">
          <PullRequestChecks checks={checks} hiddenChecks={hiddenChecks} />
        </TabsContent>
        <TabsContent value="files">
          <PullRequestFiles
            files={pullRequest.files}
            fileCount={fileCount}
            url={url}
            revision={revision}
          />
        </TabsContent>
      </Tabs>
    </article>
  )
}
