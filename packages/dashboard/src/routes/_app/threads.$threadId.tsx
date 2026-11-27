import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { SessionPanel } from '#/components/session/session-panel.tsx'
import { useIsThreadActive } from '#/hooks/use-host-status.ts'
import {
  listBotThreadsQueryOpts,
  titleOfThread
} from '#/queries/bot-threads.ts'
import { listWorkersQueryOpts } from '#/queries/workers.ts'
import { StartedWorkers } from './-components/started-workers.tsx'

const BotThreadPage = () => {
  const { threadId } = Route.useParams()
  const isThreadActive = useIsThreadActive('bot', threadId)
  const botThreadsQuery = useQuery(listBotThreadsQueryOpts())
  const workersQuery = useQuery(listWorkersQueryOpts())
  const thread = botThreadsQuery.data?.find((candidate) => {
    return candidate.threadId === threadId
  })
  const startedWorkers = (workersQuery.data ?? []).filter(
    ({ originThreadId }) => {
      return originThreadId === threadId
    }
  )

  return (
    <SessionPanel
      key={threadId}
      harness="bot"
      threadId={threadId}
      isThreadActive={isThreadActive}
      header={
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-muted-foreground">A thread with the bot</p>
          <h1
            dir="auto"
            className="line-clamp-2 max-w-measure text-xl leading-tight font-semibold sm:text-2xl"
          >
            {thread === undefined ? 'Bot thread' : titleOfThread(thread)}
          </h1>
        </div>
      }
      startedWorkers={<StartedWorkers workers={startedWorkers} />}
    />
  )
}

export const Route = createFileRoute('/_app/threads/$threadId')({
  staticData: { section: 'Bot threads', crumb: 'Thread' },
  head: () => {
    return { meta: [{ title: 'Bot thread' }] }
  },
  component: BotThreadPage
})
