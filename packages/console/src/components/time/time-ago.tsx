import { useNow } from '#/hooks/use-now.ts'
import { formatAgo, formatDate, formatDateTime } from '#/lib/dates.ts'

const MILLISECONDS_PER_DAY = 86_400_000

type TimeAgoProps = {
  value: number
  className?: string
  recentLabel?: string
  absoluteAfterDays?: number
}

export const TimeAgo = ({
  value,
  className,
  recentLabel,
  absoluteAfterDays
}: TimeAgoProps) => {
  const now = useNow()
  const isOld =
    absoluteAfterDays !== undefined &&
    now - value > absoluteAfterDays * MILLISECONDS_PER_DAY
  const text = isOld
    ? `on ${formatDate(value)}`
    : (formatAgo(value, now) ?? recentLabel)

  if (text === undefined) {
    return null
  }

  return (
    <time
      dateTime={new Date(value).toISOString()}
      title={formatDateTime(value)}
      className={className}
    >
      {text}
    </time>
  )
}
