import {
  ExternalLinkIcon,
  SignalHighIcon,
  TagIcon,
  UserCheckIcon
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { TicketDetails } from '@workcell/core'
import { Fact, FactList } from '#/components/facts/fact-list.tsx'
import { DescriptionDisclosure } from '#/components/markdown/description-disclosure.tsx'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import { getTicketQueryOpts } from '#/queries/tickets.ts'
import type { TicketRead as TicketReadResult } from '#/server/tickets.functions.ts'
import { PersonLine } from './person-line.tsx'
import { TicketLabelChip } from './ticket-label.tsx'
import { TicketStateBadge } from './ticket-state-badge.tsx'

type TicketArticleProps = {
  ticket: TicketDetails
}

const TicketArticle = ({ ticket }: TicketArticleProps) => {
  const { key, title, url, state, priority, labels, assignees, description } =
    ticket

  return (
    <article aria-label={`Ticket ${key}`} className="flex flex-col gap-5">
      <header className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-1 text-sm font-semibold underline-offset-4 hover:underline"
          >
            {key}
            <ExternalLinkIcon
              aria-hidden
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <TicketStateBadge state={state} />
        </div>
        <h2
          dir="auto"
          className="text-lg leading-snug font-semibold text-pretty break-words"
        >
          {title}
        </h2>
      </header>
      <FactList>
        <Fact
          title="Priority"
          icon={SignalHighIcon}
          isEmpty={priority === undefined}
          empty="None"
        >
          {priority}
        </Fact>
        <Fact
          title="Assignees"
          icon={UserCheckIcon}
          isEmpty={assignees.length === 0}
          empty="No one"
        >
          {assignees.map(({ name, avatarUrl }) => {
            return <PersonLine key={name} name={name} avatarUrl={avatarUrl} />
          })}
        </Fact>
        <Fact
          title="Labels"
          icon={TagIcon}
          isEmpty={labels.length === 0}
          empty="None"
        >
          {labels.map((label) => {
            return <TicketLabelChip key={label.name} label={label} />
          })}
        </Fact>
      </FactList>
      <DescriptionDisclosure
        text={description}
        empty="The ticket has no description."
      />
    </article>
  )
}

type TicketReadViewProps = {
  ticketKey: string
  read: TicketReadResult | null | undefined
}

const TicketReadView = ({ ticketKey, read }: TicketReadViewProps) => {
  if (read === undefined) {
    return (
      <div
        aria-busy
        aria-label="Loading the ticket"
        className="flex flex-col gap-3"
      >
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    )
  }

  if (read === null) {
    return (
      <p className="text-sm text-muted-foreground">
        No tracker is plugged into this host, so the ticket {ticketKey} stays
        unread.
      </p>
    )
  }

  if ('failure' in read) {
    return (
      <p role="alert" data-status="failed" className="text-sm text-status">
        {read.tracker} gave no ticket: {read.failure}
      </p>
    )
  }

  if (read.ticket === null) {
    return (
      <p className="text-sm text-muted-foreground">
        {read.tracker} has no ticket {ticketKey} that this host can read.
      </p>
    )
  }

  return <TicketArticle ticket={read.ticket} />
}

type TicketReadProps = {
  ticketKey: string
  workerActiveAt: number | undefined
}

const TicketRead = ({ ticketKey, workerActiveAt }: TicketReadProps) => {
  const ticketQuery = useQuery({
    ...getTicketQueryOpts(ticketKey, workerActiveAt),
    placeholderData: (previous) => {
      return previous
    }
  })

  if (ticketQuery.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        The host did not answer. The ticket reads again when the pull request of
        the worker changes.
      </p>
    )
  }

  return <TicketReadView ticketKey={ticketKey} read={ticketQuery.data} />
}

type TicketPanelProps = {
  subject: string | undefined
  workerActiveAt: number | undefined
}

export const TicketPanel = ({ subject, workerActiveAt }: TicketPanelProps) => {
  if (subject === undefined) {
    return (
      <p className="text-sm text-muted-foreground">
        This worker carries no ticket: it started from a message.
      </p>
    )
  }

  return <TicketRead ticketKey={subject} workerActiveAt={workerActiveAt} />
}
