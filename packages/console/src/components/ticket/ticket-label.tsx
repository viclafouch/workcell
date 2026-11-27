import type { TicketLabel } from '@workcell/core'
import { Badge } from '#/components/ui/badge.tsx'

type TicketLabelChipProps = {
  label: TicketLabel
}

export const TicketLabelChip = ({ label }: TicketLabelChipProps) => {
  return (
    <Badge variant="outline" title={label.name} className="max-w-48 min-w-0">
      {label.color === undefined ? null : (
        <span
          aria-hidden
          className="label-dot"
          style={{ backgroundColor: label.color }}
        />
      )}
      <span dir="auto" className="truncate">
        {label.name}
      </span>
    </Badge>
  )
}
