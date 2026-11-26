import { Spinner } from '#/components/ui/spinner.tsx'

export const DefaultPending = () => {
  return (
    <div className="grid min-h-60 place-items-center text-muted-foreground">
      <Spinner className="size-5" />
    </div>
  )
}
