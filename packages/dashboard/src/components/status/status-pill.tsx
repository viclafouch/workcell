import { Badge } from '#/components/ui/badge.tsx'
import { StatusDot } from '#/components/worker/status-dot.tsx'
import type { WorkerStatus } from '#/constants/worker-status.ts'
import { Hint } from './hint.tsx'

type StatusPillProps = {
  status: WorkerStatus
}

export const StatusPill = ({ status }: StatusPillProps) => {
  return (
    <Hint label={status.hint}>
      <Badge
        variant="outline"
        data-status={status.tone}
        className="status-pill"
      >
        <StatusDot tone={status.tone} />
        {status.label}
      </Badge>
    </Hint>
  )
}
