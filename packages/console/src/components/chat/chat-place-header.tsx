import {
  ExternalLinkIcon,
  HashIcon,
  LockIcon,
  MessageCircleIcon
} from 'lucide-react'
import { Skeleton } from '#/components/ui/skeleton.tsx'
import type { ChatMark, ChatThreadDetails } from '#/server/console-context.ts'
import { ChatMarkIcon } from './chat-mark-icon.tsx'

const EXTERNAL_LINK =
  'underline-offset-4 hover:underline focus-visible:focus-ring rounded-sm'

const HEADER =
  'flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 text-sm sm:px-6'

const PLACE_ICON = 'size-3.5 shrink-0 text-muted-foreground'

type PlaceIconProps = {
  place: ChatThreadDetails['place']
}

const PlaceIcon = ({ place }: PlaceIconProps) => {
  if (place.isDM) {
    return <MessageCircleIcon aria-hidden className={PLACE_ICON} />
  }

  return place.isPrivate ? (
    <LockIcon aria-hidden className={PLACE_ICON} />
  ) : (
    <HashIcon aria-hidden className={PLACE_ICON} />
  )
}

const placeNameOf = (place: ChatThreadDetails['place']) => {
  if (place.isDM) {
    return 'Direct message'
  }

  return place.name ?? (place.isPrivate ? 'Private channel' : 'Channel')
}

type ChatPlaceHeaderProps = {
  chatMark: ChatMark
  details: ChatThreadDetails | null
}

export const ChatPlaceHeader = ({
  chatMark,
  details
}: ChatPlaceHeaderProps) => {
  if (details === null) {
    return (
      <header className={HEADER}>
        <ChatMarkIcon chatMark={chatMark} />
        <Skeleton className="h-4 w-32" />
      </header>
    )
  }

  const { place, workspace, threadUrl } = details
  const placeName = placeNameOf(place)

  return (
    <header className={HEADER}>
      <ChatMarkIcon chatMark={chatMark} />
      <span className="flex min-w-0 items-center gap-1 font-medium">
        <PlaceIcon place={place} />
        {place.url === undefined ? (
          <span className="truncate">{placeName}</span>
        ) : (
          <a
            href={place.url}
            target="_blank"
            rel="noreferrer"
            className={`truncate ${EXTERNAL_LINK}`}
          >
            {placeName}
          </a>
        )}
      </span>
      {workspace === undefined ? null : (
        <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
          in
          <a
            href={workspace.url}
            target="_blank"
            rel="noreferrer"
            className={`truncate ${EXTERNAL_LINK}`}
          >
            {workspace.name}
          </a>
        </span>
      )}
      {threadUrl === undefined ? null : (
        <a
          href={threadUrl}
          target="_blank"
          rel="noreferrer"
          className={`ml-auto flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground ${EXTERNAL_LINK}`}
        >
          Open in {chatMark.name}
          <ExternalLinkIcon aria-hidden className="size-3.5" />
        </a>
      )}
    </header>
  )
}
