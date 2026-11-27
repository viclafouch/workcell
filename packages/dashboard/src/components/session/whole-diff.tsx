import { useQuery } from '@tanstack/react-query'
import { Button } from '#/components/ui/button.tsx'
import { Spinner } from '#/components/ui/spinner.tsx'
import { splitPatchByFile } from '#/lib/diff.ts'
import { getWorkerDiffQueryOpts } from '#/queries/workers.ts'
import { LazyDiffCode } from './lazy-diff-code.tsx'

const FILES_IN_FIRST_VIEW = 2

type WholeDiffProps = {
  threadId: string
}

export const WholeDiff = ({ threadId }: WholeDiffProps) => {
  const diffQuery = useQuery(getWorkerDiffQueryOpts(threadId))

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
        {diffQuery.data === undefined ? 'Read the whole diff' : 'Read it again'}
      </Button>
      {diffQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          The sandbox did not answer. Read it again once the worker is awake.
        </p>
      ) : null}
      {diffQuery.data === null ? (
        <p className="text-sm text-muted-foreground">
          This worker has no sandbox open, so there is no diff to read.
        </p>
      ) : null}
      {typeof diffQuery.data === 'string' ? (
        <ul
          aria-label="Changed files of the branch"
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
