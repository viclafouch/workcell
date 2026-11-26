import { Skeleton } from '#/components/ui/skeleton.tsx'
import { Spinner } from '#/components/ui/spinner.tsx'

export const AppShellSkeleton = () => {
  return (
    <div className="flex min-h-dvh">
      <div className="hidden w-64 shrink-0 flex-col gap-6 border-r bg-sidebar p-4 md:flex">
        <Skeleton className="h-6 w-28" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <div className="flex flex-1 flex-col">
        <div className="flex h-topbar items-center border-b px-4">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="grid flex-1 place-items-center text-muted-foreground">
          <Spinner className="size-5" />
        </div>
      </div>
    </div>
  )
}
