const dateTime = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

export const formatDateTime = (value: string | number) => {
  return dateTime.format(new Date(value))
}

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

const MILLISECONDS_PER_SECOND = 1000

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
  { unit: 'second', seconds: 1, below: 60 },
  { unit: 'minute', seconds: 60, below: 3600 },
  { unit: 'hour', seconds: 3600, below: 86_400 },
  { unit: 'day', seconds: 86_400, below: 604_800 },
  { unit: 'week', seconds: 604_800, below: 2_629_800 },
  { unit: 'month', seconds: 2_629_800, below: 31_557_600 },
  YEARS
]

export const formatAgo = (value: number, now = Date.now()) => {
  const elapsedSeconds = (value - now) / MILLISECONDS_PER_SECOND
  const { unit, seconds } =
    RELATIVE_STEPS.find(({ below }) => {
      return Math.abs(elapsedSeconds) < below
    }) ?? YEARS

  return relativeTime.format(Math.round(elapsedSeconds / seconds), unit)
}
