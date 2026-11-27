import { BotIcon, ChevronRightIcon } from 'lucide-react'
import type { SessionIndexEntry } from '@tanstack/ai-persistence'
import { Link } from '@tanstack/react-router'
import type { WorkerView } from '@workcell/core'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle
} from '#/components/ui/item.tsx'
import { formatAgo } from '#/lib/dates.ts'
import { titleOfThread } from '#/queries/bot-threads.ts'

const listFormat = new Intl.ListFormat('en', { type: 'conjunction' })

type BotThreadsProps = {
  threads: readonly SessionIndexEntry[]
  workers: readonly WorkerView[]
}

export const BotThreads = ({ threads, workers }: BotThreadsProps) => {
  return (
    <ul aria-label="Bot threads" className="flex flex-col gap-2">
      {threads.map((thread) => {
        const started = workers.flatMap(({ name, originThreadId }) => {
          return originThreadId === thread.threadId ? [name] : []
        })

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
              <ItemContent className="min-w-0">
                <ItemTitle dir="auto" className="line-clamp-2">
                  {titleOfThread(thread)}
                </ItemTitle>
                <ItemDescription>
                  Last message {formatAgo(thread.updatedAt)}.
                  {started.length === 0
                    ? null
                    : ` Started ${listFormat.format(started)}.`}
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
