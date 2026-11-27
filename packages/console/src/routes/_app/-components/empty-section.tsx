import type { LucideIcon } from 'lucide-react'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '#/components/ui/empty.tsx'

type EmptySectionProps = {
  icon: LucideIcon
  title: string
  description: string
}

export const EmptySection = ({
  icon: Icon,
  title,
  description
}: EmptySectionProps) => {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
