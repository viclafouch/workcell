import { useQuery } from '@tanstack/react-query'
import { Button } from '#/components/ui/button.tsx'
import { Spinner } from '#/components/ui/spinner.tsx'
import { getWorkerDiffQueryOpts } from '#/queries/workers.ts'
import { DiffCode } from './diff-code.tsx'

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
        <DiffCode patch={diffQuery.data} title="The whole diff of the branch" />
      ) : null}
    </div>
  )
}
