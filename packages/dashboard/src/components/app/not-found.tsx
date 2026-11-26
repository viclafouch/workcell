import { Link } from '@tanstack/react-router'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle
} from '#/components/ui/empty.tsx'

export const NotFound = () => {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Nothing lives at this address</EmptyTitle>
        <EmptyDescription>
          The thread may have been deleted, or the link has a typo.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link to="/" className="underline underline-offset-4">
          See what runs now
        </Link>
      </EmptyContent>
    </Empty>
  )
}
