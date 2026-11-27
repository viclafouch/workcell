import {
  FileDiffIcon,
  FileMinusIcon,
  FilePlusIcon,
  FileSymlinkIcon
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { PullRequestFile } from '@workcell/core'
import { LazyDiffCode } from '#/components/session/lazy-diff-code.tsx'
import { MiddleTruncate } from '#/components/text/middle-truncate.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Spinner } from '#/components/ui/spinner.tsx'
import { countOf, formatCount } from '#/lib/count-words.ts'
import { splitPatchByFile } from '#/lib/diff.ts'
import { getPullRequestDiffQueryOpts } from '#/queries/pull-requests.ts'

const FILES_IN_FIRST_VIEW = 2

const FILE_ICONS = {
  added: FilePlusIcon,
  removed: FileMinusIcon,
  modified: FileDiffIcon,
  renamed: FileSymlinkIcon,
  copied: FileSymlinkIcon,
  changed: FileDiffIcon
} as const satisfies Record<PullRequestFile['status'], unknown>

type PullRequestDiffProps = {
  url: string
  revision: string | undefined
}

const PullRequestDiff = ({ url, revision }: PullRequestDiffProps) => {
  const diffQuery = useQuery(getPullRequestDiffQueryOpts(url, revision))

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        disabled={diffQuery.isFetching}
        onClick={() => {
          void diffQuery.refetch()
        }}
      >
        {diffQuery.isFetching ? <Spinner /> : null}
        {diffQuery.data === undefined ? 'Read the diff' : 'Read it again'}
      </Button>
      {diffQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          The diff did not load: {diffQuery.error.message}
        </p>
      ) : null}
      {diffQuery.data === null ? (
        <p className="text-sm text-muted-foreground">
          The pull request gives no diff to read.
        </p>
      ) : null}
      {typeof diffQuery.data === 'string' ? (
        <ul
          aria-label="Diff of the pull request"
          className="flex flex-col gap-3"
        >
          {splitPatchByFile(diffQuery.data).map(({ path, patch }, index) => {
            return (
              <li key={path}>
                <LazyDiffCode
                  patch={patch}
                  path={path}
                  className={
                    index < FILES_IN_FIRST_VIEW ? undefined : 'defer-render'
                  }
                />
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

type PullRequestFilesProps = PullRequestDiffProps & {
  files: readonly PullRequestFile[]
  fileCount: number
}

export const PullRequestFiles = ({
  files,
  fileCount,
  url,
  revision
}: PullRequestFilesProps) => {
  return (
    <div className="flex flex-col gap-4">
      <ul aria-label="Changed files" className="flex flex-col">
        {files.map(({ path, status, additions, deletions }) => {
          const Icon = FILE_ICONS[status]

          return (
            <li
              key={path}
              className="flex min-w-0 items-center gap-2 py-1.5 text-sm"
            >
              <Icon
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="sr-only">{status}</span>
              <MiddleTruncate
                text={path}
                className="flex-1 font-mono text-label"
              />
              <span className="shrink-0 tabular text-label">
                <span data-signal="success" className="text-signal">
                  +{formatCount(additions)}
                </span>{' '}
                <span data-signal="danger" className="text-signal">
                  -{formatCount(deletions)}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
      {files.length < fileCount ? (
        <p className="text-sm text-muted-foreground">
          {formatCount(files.length)} of {countOf(fileCount, 'file', 'files')}{' '}
          listed. The diff holds them all.
        </p>
      ) : null}
      <PullRequestDiff url={url} revision={revision} />
    </div>
  )
}
