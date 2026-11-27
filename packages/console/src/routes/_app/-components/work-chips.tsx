import type React from 'react'
import { ExternalLinkIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type {
  IntegrationMark as IntegrationMarkShape,
  WorkerView
} from '@workcell/core'
import { IntegrationMark } from '#/components/marks/integration-mark.tsx'
import { PullRequestStatePill } from '#/components/pull-request/pull-request-state-pill.tsx'
import { TicketStateBadge } from '#/components/ticket/ticket-state-badge.tsx'
import { getIntegrationMarksQueryOpts } from '#/queries/marks.ts'
import { getPullRequestQueryOpts } from '#/queries/pull-requests.ts'
import { getTicketQueryOpts } from '#/queries/tickets.ts'
import type { PullRequestRead } from '#/server/pull-requests.functions.ts'
import type { TicketRead } from '#/server/tickets.functions.ts'

type ChipLinkProps = {
  href: string
  label: string
  mark: IntegrationMarkShape | null | undefined
  children: React.ReactNode
}

const ChipLink = ({ href, label, mark, children }: ChipLinkProps) => {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-8 max-w-full min-w-0 items-center gap-2 overflow-hidden rounded-md border px-2 text-sm text-foreground hover:bg-muted"
    >
      {mark === null || mark === undefined ? null : (
        <IntegrationMark mark={mark} />
      )}
      <span className="shrink-0 font-semibold">{label}</span>
      {children}
      <ExternalLinkIcon
        aria-hidden
        className="size-3 shrink-0 text-muted-foreground"
      />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

const ticketOfRead = (read: TicketRead | null) => {
  return read !== null && 'ticket' in read ? read.ticket : null
}

const pullRequestOfRead = (read: PullRequestRead | null) => {
  return read !== null && 'pullRequest' in read ? read.pullRequest : null
}

type TicketChipProps = {
  worker: WorkerView
}

export const TicketChip = ({ worker }: TicketChipProps) => {
  const ticketQuery = useQuery({
    ...getTicketQueryOpts(worker.subject ?? '', worker.lastActiveAt),
    enabled: worker.subject !== undefined,
    select: ticketOfRead
  })

  const marksQuery = useQuery(getIntegrationMarksQueryOpts())

  if (ticketQuery.data === undefined || ticketQuery.data === null) {
    return null
  }

  return (
    <ChipLink
      href={ticketQuery.data.url}
      label={ticketQuery.data.key}
      mark={marksQuery.data?.tracker}
    >
      <TicketStateBadge state={ticketQuery.data.state} />
    </ChipLink>
  )
}

type PullRequestChipProps = {
  worker: WorkerView
}

export const PullRequestChip = ({ worker }: PullRequestChipProps) => {
  const pullRequestQuery = useQuery({
    ...getPullRequestQueryOpts(
      worker.pullRequest ?? '',
      worker.pullRequestRevision
    ),
    enabled: worker.pullRequest !== undefined,
    placeholderData: (previous) => {
      return previous
    },
    select: pullRequestOfRead
  })

  const marksQuery = useQuery(getIntegrationMarksQueryOpts())

  if (pullRequestQuery.data === undefined || pullRequestQuery.data === null) {
    return null
  }

  return (
    <ChipLink
      href={pullRequestQuery.data.url}
      label={pullRequestQuery.data.key}
      mark={marksQuery.data?.pullRequests}
    >
      <PullRequestStatePill pullRequest={pullRequestQuery.data} size="sm" />
    </ChipLink>
  )
}

type WorkerTitleProps = {
  worker: WorkerView
}

export const WorkerTitle = ({ worker }: WorkerTitleProps) => {
  const ticketQuery = useQuery({
    ...getTicketQueryOpts(worker.subject ?? '', worker.lastActiveAt),
    enabled: worker.subject !== undefined,
    select: ticketOfRead
  })

  return (
    <h1
      dir="auto"
      className="line-clamp-2 max-w-measure text-xl leading-tight font-semibold text-balance sm:text-2xl"
    >
      {ticketQuery.data?.title ?? worker.topic}
    </h1>
  )
}
