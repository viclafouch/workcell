import { cn } from 'cn'
import { matchIsLiveTone, type StatusTone } from '#/constants/worker-status.ts'

type StatusDotProps = {
  tone: StatusTone
  className?: string
}

export const StatusDot = ({ tone, className }: StatusDotProps) => {
  return (
    <span
      aria-hidden
      data-status={tone}
      data-live={matchIsLiveTone(tone) ? '' : undefined}
      className={cn('status-dot', className)}
    />
  )
}
