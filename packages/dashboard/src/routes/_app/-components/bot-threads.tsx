import { BotIcon, ChevronRightIcon } from 'lucide-react'
import type { SessionIndexEntry } from '@tanstack/ai-persistence'
import { Link } from '@tanstack/react-router'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle
} from '#/components/ui/item.tsx'
import { formatDateTime } from '#/lib/dates.ts'

type BotThreadsProps = {
  threads: readonly SessionIndexEntry[]
}

export const BotThreads = ({ threads }: BotThreadsProps) => {
  return (
    <ul aria-label="Bot threads" className="flex flex-col gap-2">
      {threads.map((thread) => {
        return (
          <li key={thread.threadId}>
            <Item
              variant="outline"
              size="sm"
              render={
                <Link
                  to="/threads/$threadId"
                  params={{ threadId: thread.threadId }}
                />
              }
            >
              <ItemMedia variant="icon">
                <BotIcon aria-hidden />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{thread.title ?? thread.threadId}</ItemTitle>
                <ItemDescription>
                  Last message {formatDateTime(thread.updatedAt)}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <ChevronRightIcon aria-hidden className="size-4" />
              </ItemActions>
            </Item>
          </li>
        )
      })}
    </ul>
  )
}
