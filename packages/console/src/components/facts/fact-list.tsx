import type React from 'react'
import type { LucideIcon } from 'lucide-react'

type FactListProps = {
  children: React.ReactNode
}

export const FactList = ({ children }: FactListProps) => {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-y-2.5">
      {children}
    </dl>
  )
}

type FactProps = {
  title: string
  icon: LucideIcon
  isEmpty: boolean
  empty: string
  children: React.ReactNode
}

export const Fact = ({
  title,
  icon: Icon,
  isEmpty,
  empty,
  children
}: FactProps) => {
  return (
    <div className="col-span-2 grid grid-cols-subgrid items-start gap-x-4">
      <dt className="flex items-center gap-1.5 py-0.5 text-sm text-muted-foreground">
        <Icon aria-hidden className="size-4" />
        {title}
      </dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 py-0.5 text-sm">
        {isEmpty ? (
          <span className="text-muted-foreground">{empty}</span>
        ) : (
          children
        )}
      </dd>
    </div>
  )
}
