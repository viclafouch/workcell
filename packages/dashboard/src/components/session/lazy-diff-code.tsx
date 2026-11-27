import React from 'react'
import { Skeleton } from '#/components/ui/skeleton.tsx'

const DiffCode = React.lazy(async () => {
  const { DiffCode: LoadedDiffCode } = await import('./diff-code.tsx')

  return { default: LoadedDiffCode }
})

type LazyDiffCodeProps = React.ComponentProps<typeof DiffCode>

export const LazyDiffCode = (props: LazyDiffCodeProps) => {
  return (
    <React.Suspense fallback={<Skeleton className="h-24" />}>
      <DiffCode {...props} />
    </React.Suspense>
  )
}
