const dateTime = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

export const formatDateTime = (value: string | number) => {
  return dateTime.format(new Date(value))
}

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

const MILLISECONDS_PER_SECOND = 1000

const RECENT_SECONDS = 120

type RelativeStep = {
  unit: Intl.RelativeTimeFormatUnit
  seconds: number
  below: number
}

const YEARS: RelativeStep = {
  unit: 'year',
  seconds: 31_557_600,
  below: Infinity
}

const RELATIVE_STEPS: readonly RelativeStep[] = [
  { unit: 'minute', seconds: 60, below: 3600 },
  { unit: 'hour', seconds: 3600, below: 86_400 },
  { unit: 'day', seconds: 86_400, below: 604_800 },
  { unit: 'week', seconds: 604_800, below: 2_629_800 },
  { unit: 'month', seconds: 2_629_800, below: 31_557_600 },
  YEARS
]

export const formatAgo = (value: number, now: number) => {
  const elapsedSeconds = (value - now) / MILLISECONDS_PER_SECOND

  if (Math.abs(elapsedSeconds) < RECENT_SECONDS) {
    return null
  }

  const { unit, seconds } =
    RELATIVE_STEPS.find(({ below }) => {
      return Math.abs(elapsedSeconds) < below
    }) ?? YEARS

  return relativeTime.format(Math.trunc(elapsedSeconds / seconds), unit)
}

const clockTime = new Intl.DateTimeFormat('en', { timeStyle: 'short' })

const dayAndClockTime = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})

const MILLISECONDS_PER_DAY = 86_400_000

export const formatMessageTime = (value: number, now: number) => {
  return now - value < MILLISECONDS_PER_DAY &&
    new Date(value).getDate() === new Date(now).getDate()
    ? clockTime.format(value)
    : dayAndClockTime.format(value)
}

const SECONDS_PER_MINUTE = 60

export const formatDuration = (milliseconds: number) => {
  const seconds = Math.max(
    0,
    Math.round(milliseconds / MILLISECONDS_PER_SECOND)
  )

  if (seconds < SECONDS_PER_MINUTE) {
    return `${seconds}s`
  }

  return `${Math.floor(seconds / SECONDS_PER_MINUTE)}m ${seconds % SECONDS_PER_MINUTE}s`
}
