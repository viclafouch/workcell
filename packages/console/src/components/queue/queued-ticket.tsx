import { CircleSlashIcon, ExternalLinkIcon } from 'lucide-react'
import type { QueuedTicket } from '@workcell/core'
import { PersonLine } from '#/components/ticket/person-line.tsx'
import { TicketLabelChip } from '#/components/ticket/ticket-label.tsx'
import { Badge } from '#/components/ui/badge.tsx'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle
} from '#/components/ui/item.tsx'

const SHOWN_LABELS = 4

type QueuedTicketItemProps = {
  ticket: QueuedTicket
  rank: number | null
}

export const QueuedTicketItem = ({ ticket, rank }: QueuedTicketItemProps) => {
  const { key, title, url, state, labels, assignees, priority, blocker } =
    ticket
  const hiddenLabels = labels.length - SHOWN_LABELS

  return (
    <Item
      variant="outline"
      size="sm"
      className="relative flex-nowrap items-start has-[a:focus-visible]:border-ring has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-ring/50 has-[a:hover]:bg-muted"
    >
      <ItemMedia
        className="w-8 justify-center self-start pt-0.5"
        data-status={rank === null ? 'failed' : undefined}
      >
        {rank === null ? (
          <>
            <CircleSlashIcon aria-hidden className="size-5 text-status" />
            <span className="sr-only">Cannot start</span>
          </>
        ) : (
          <span className="text-2xl leading-none font-semibold tabular">
            <span className="sr-only">Number </span>
            {rank}
            <span className="sr-only"> in line</span>
          </span>
        )}
      </ItemMedia>
      <ItemContent className="min-w-0 gap-1.5">
        <ItemTitle className="w-full min-w-0 items-baseline">
          <span className="shrink-0 font-mono text-label text-muted-foreground">
            {key}
          </span>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            dir="auto"
            className="min-w-0 break-words outline-none after:absolute after:inset-0 after:rounded-md"
          >
            {title}
          </a>
        </ItemTitle>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{state.name}</Badge>
          {priority === undefined ? null : (
            <Badge variant="outline">{priority}</Badge>
          )}
          {labels.slice(0, SHOWN_LABELS).map((label) => {
            return <TicketLabelChip key={label.name} label={label} />
          })}
          {hiddenLabels > 0 ? (
            <span className="text-label text-muted-foreground">
              {`+${hiddenLabels}`}
              <span className="sr-only"> more labels</span>
            </span>
          ) : null}
          {assignees.map(({ name, avatarUrl }) => {
            return <PersonLine key={name} name={name} avatarUrl={avatarUrl} />
          })}
        </span>
        {blocker === undefined ? null : (
          <ItemDescription
            data-status="failed"
            className="line-clamp-none text-status"
          >
            {blocker}
          </ItemDescription>
        )}
      </ItemContent>
      <ItemActions className="self-start pt-0.5 text-muted-foreground">
        <ExternalLinkIcon aria-hidden className="size-4" />
        <span className="sr-only">Opens in a new tab</span>
      </ItemActions>
    </Item>
  )
}
