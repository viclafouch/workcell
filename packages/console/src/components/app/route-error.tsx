import { useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { Button } from '#/components/ui/button.tsx'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle
} from '#/components/ui/empty.tsx'

type RouteErrorProps = ErrorComponentProps

export const RouteError = ({ error }: RouteErrorProps) => {
  const router = useRouter()

  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>The host did not answer</EmptyTitle>
        <EmptyDescription>
          {error instanceof Error ? error.message : String(error)}. Check that
          the host runs, then load the page again.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          variant="outline"
          onClick={() => {
            void router.invalidate()
          }}
        >
          Load again
        </Button>
      </EmptyContent>
    </Empty>
  )
}
