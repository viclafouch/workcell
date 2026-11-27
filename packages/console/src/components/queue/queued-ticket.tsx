import { CircleSlashIcon, ExternalLinkIcon, UserIcon } from 'lucide-react'
import type { QueuedTicket, TicketLabel } from '@workcell/core'
import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar.tsx'
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

type LabelChipProps = {
  label: TicketLabel
}

const LabelChip = ({ label }: LabelChipProps) => {
  return (
    <Badge variant="outline" className="max-w-48">
      {label.color === undefined ? null : (
        <span
          aria-hidden
          className="label-dot"
          style={{ backgroundColor: label.color }}
        />
      )}
      <span dir="auto" className="truncate">
        {label.name}
      </span>
    </Badge>
  )
}

type QueuedTicketItemProps = {
  ticket: QueuedTicket
  place: number | null
}

export const QueuedTicketItem = ({ ticket, place }: QueuedTicketItemProps) => {
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
        data-status={place === null ? 'failed' : undefined}
      >
        {place === null ? (
          <>
            <CircleSlashIcon aria-hidden className="size-5 text-status" />
            <span className="sr-only">Cannot start</span>
          </>
        ) : (
          <span className="text-2xl leading-none font-semibold tabular">
            <span className="sr-only">Place </span>
            {place}
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
            return <LabelChip key={label.name} label={label} />
          })}
          {hiddenLabels > 0 ? (
            <span className="text-label text-muted-foreground">
              {`+${hiddenLabels}`}
              <span className="sr-only"> more labels</span>
            </span>
          ) : null}
          {assignees.map(({ name, avatarUrl }) => {
            return (
              <span
                key={name}
                className="inline-flex min-w-0 items-center gap-1.5 text-label text-muted-foreground"
              >
                <Avatar size="sm" className="size-5">
                  {avatarUrl === undefined ? null : (
                    <AvatarImage src={avatarUrl} alt="" loading="lazy" />
                  )}
                  <AvatarFallback>
                    <UserIcon aria-hidden className="size-3" />
                  </AvatarFallback>
                </Avatar>
                <span dir="auto" className="truncate">
                  {name}
                </span>
              </span>
            )
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
