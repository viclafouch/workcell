import { ChevronRightIcon } from 'lucide-react'
import type { SessionIndexEntry } from '@tanstack/ai-persistence'
import { Link } from '@tanstack/react-router'
import type { WorkerView } from '@workcell/core'
import { BotThreadStatus } from '#/components/chat/bot-thread-status.tsx'
import { ThreadChatIcon } from '#/components/chat/thread-chat-icon.tsx'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle
} from '#/components/ui/item.tsx'
import { useNow } from '#/hooks/use-now.ts'
import { formatAgo } from '#/lib/dates.ts'
import { titleOfThread } from '#/queries/bot-threads.ts'

const listFormat = new Intl.ListFormat('en', { type: 'conjunction' })

type LastMessageProps = {
  updatedAt: number
}

const LastMessage = ({ updatedAt }: LastMessageProps) => {
  const now = useNow()
  const ago = formatAgo(updatedAt, now)

  return ago === null ? null : `Last message ${ago}.`
}

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
                <ThreadChatIcon threadId={thread.threadId} />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle dir="auto" className="line-clamp-2">
                  {titleOfThread(thread)}
                </ItemTitle>
                <ItemDescription>
                  <LastMessage updatedAt={thread.updatedAt} />
                  {started.length === 0
                    ? null
                    : ` Started ${listFormat.format(started)}.`}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <BotThreadStatus threadId={thread.threadId} />
                <ChevronRightIcon aria-hidden className="size-4" />
              </ItemActions>
            </Item>
          </li>
        )
      })}
    </ul>
  )
}
