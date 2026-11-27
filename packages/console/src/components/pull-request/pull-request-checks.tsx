import { ExternalLinkIcon } from 'lucide-react'
import type { PullRequestCheck } from '@workcell/core'
import { CHECK_STATUSES } from '#/constants/pull-request-status.ts'
import { formatCount } from '#/lib/count-words.ts'

const CHECK_ORDER = [
  'failure',
  'pending',
  'success',
  'cancelled',
  'neutral',
  'skipped'
] as const satisfies readonly PullRequestCheck['state'][]

const countLine = (checks: readonly PullRequestCheck[]) => {
  return CHECK_ORDER.flatMap((state) => {
    const count = checks.filter((check) => {
      return check.state === state
    }).length

    return count === 0
      ? []
      : [`${formatCount(count)} ${CHECK_STATUSES[state].label.toLowerCase()}`]
  }).join(', ')
}

const hiddenLine = (hiddenChecks: number) => {
  return hiddenChecks === 1
    ? '1 more check runs on this pull request, but the token of this host cannot read it.'
    : `${formatCount(hiddenChecks)} more checks run on this pull request, but the token of this host cannot read them.`
}

type PullRequestChecksProps = {
  checks: readonly PullRequestCheck[]
  hiddenChecks: number
}

export const PullRequestChecks = ({
  checks,
  hiddenChecks
}: PullRequestChecksProps) => {
  const sorted = checks.toSorted((left, right) => {
    return CHECK_ORDER.indexOf(left.state) - CHECK_ORDER.indexOf(right.state)
  })

  return (
    <div className="flex flex-col gap-3">
      {checks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No check reports on this pull request.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{countLine(checks)}</p>
          <ul aria-label="Checks" className="flex flex-col">
            {sorted.map(({ name, state, url, description }) => {
              const { signal, label, icon: Icon } = CHECK_STATUSES[state]

              return (
                <li
                  key={`${name}-${url ?? ''}`}
                  className="flex min-w-0 items-start gap-2.5 border-b py-2 text-sm last:border-b-0"
                >
                  <Icon
                    aria-hidden
                    data-signal={signal}
                    className="mt-0.5 size-4 shrink-0 text-signal"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    {url === undefined ? (
                      <span dir="auto" className="break-words">
                        {name}
                      </span>
                    ) : (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        dir="auto"
                        className="break-words underline-offset-4 hover:underline"
                      >
                        {name}
                        <ExternalLinkIcon
                          aria-hidden
                          className="ml-1 inline size-3 text-muted-foreground"
                        />
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    )}
                    {description === undefined ? null : (
                      <span
                        dir="auto"
                        className="text-label text-muted-foreground"
                      >
                        {description}
                      </span>
                    )}
                  </span>
                  <span
                    data-signal={signal}
                    className="shrink-0 text-label text-signal"
                  >
                    {label}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
      {hiddenChecks === 0 ? null : (
        <p data-signal="attention" className="text-sm text-signal">
          {hiddenLine(hiddenChecks)}
        </p>
      )}
    </div>
  )
}
