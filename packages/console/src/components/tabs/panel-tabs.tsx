import type React from 'react'
import { cn } from 'cn'
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { formatCount } from '#/lib/count-words.ts'

type PanelTabsListProps = {
  label: string
  variant: 'segmented' | 'underline'
  children: React.ReactNode
  className?: string
}

export const PanelTabsList = ({
  label,
  variant,
  children,
  className
}: PanelTabsListProps) => {
  return (
    <TabsPrimitive.List
      aria-label={label}
      data-variant={variant}
      className={cn('panel-tabs scroll-fade-inline', className)}
    >
      {children}
      <TabsPrimitive.Indicator className="panel-tabs-indicator" />
    </TabsPrimitive.List>
  )
}

type PanelTabProps = {
  value: string
  children: React.ReactNode
  count?: number
}

export const PanelTab = ({ value, children, count }: PanelTabProps) => {
  return (
    <TabsPrimitive.Tab value={value} className="panel-tab">
      {children}
      {count === undefined ? null : (
        <span className="tab-counter">{formatCount(count)}</span>
      )}
    </TabsPrimitive.Tab>
  )
}
