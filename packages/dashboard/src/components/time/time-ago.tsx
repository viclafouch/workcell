import { useNow } from '#/hooks/use-now.ts'
import { formatAgo, formatDateTime } from '#/lib/dates.ts'

type TimeAgoProps = {
  value: number
  className?: string
}

export const TimeAgo = ({ value, className }: TimeAgoProps) => {
  const now = useNow()
  const ago = formatAgo(value, now)

  if (ago === null) {
    return null
  }

  return (
    <time
      dateTime={new Date(value).toISOString()}
      title={formatDateTime(value)}
      className={className}
    >
      {ago}
    </time>
  )
}
