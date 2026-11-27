import { CircleCheckIcon, CircleDashedIcon } from 'lucide-react'
import type { TicketState } from '@workcell/core'
import { Badge } from '#/components/ui/badge.tsx'

type TicketStateBadgeProps = {
  state: TicketState
}

export const TicketStateBadge = ({ state }: TicketStateBadgeProps) => {
  const Icon = state.category === 'closed' ? CircleCheckIcon : CircleDashedIcon

  return (
    <Badge
      variant="outline"
      title={state.name}
      className="max-w-48 min-w-0 shrink"
    >
      <Icon
        aria-hidden
        className="text-muted-foreground"
        style={state.color === undefined ? undefined : { color: state.color }}
      />
      <span dir="auto" className="truncate">
        {state.name}
      </span>
    </Badge>
  )
}
