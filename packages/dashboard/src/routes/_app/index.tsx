import { ActivityIcon, BotIcon, CircleCheckIcon } from 'lucide-react'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { FinishedTasksTable } from '#/components/worker/finished-tasks-table.tsx'
import { WorkerLanes } from '#/components/worker/worker-lanes.tsx'
import { listBotThreadsQueryOpts } from '#/queries/bot-threads.ts'
import { listWorkersQueryOpts } from '#/queries/workers.ts'
import { BotThreads } from './-components/bot-threads.tsx'
import { EmptySection } from './-components/empty-section.tsx'
import { NowHeadline } from './-components/now-headline.tsx'
import { SectionHeading } from './-components/section-heading.tsx'

const NowPage = () => {
  const workersQuery = useSuspenseQuery(listWorkersQueryOpts())
  const botThreadsQuery = useQuery(listBotThreadsQueryOpts())
  const running = workersQuery.data.filter(({ phase }) => {
    return phase !== 'finished'
  })
  const finished = workersQuery.data.filter(({ phase }) => {
    return phase === 'finished'
  })

  return (
    <div className="mx-auto flex w-full max-w-panel flex-col gap-12 px-4 py-8 sm:px-6">
      <NowHeadline workers={running} />
      <section
        aria-labelledby="running-heading"
        className="flex flex-col gap-4"
      >
        <SectionHeading id="running-heading">Running</SectionHeading>
        {running.length === 0 ? (
          <EmptySection
            icon={ActivityIcon}
            title="No worker runs"
            description="A task handed to the bot starts a worker here."
          />
        ) : (
          <WorkerLanes workers={running} label="Running workers" />
        )}
      </section>
      <section aria-labelledby="bot-heading" className="flex flex-col gap-4">
        <SectionHeading id="bot-heading">Bot threads</SectionHeading>
        {botThreadsQuery.data === undefined ||
        botThreadsQuery.data.length === 0 ? (
          <EmptySection
            icon={BotIcon}
            title={
              botThreadsQuery.isPending
                ? 'Reading the bot threads'
                : 'Nobody talked to the bot yet'
            }
            description="Each conversation with the bot shows here."
          />
        ) : (
          <BotThreads threads={botThreadsQuery.data} />
        )}
      </section>
      <section
        aria-labelledby="finished-heading"
        className="flex flex-col gap-4"
      >
        <SectionHeading id="finished-heading">Finished lately</SectionHeading>
        {finished.length === 0 ? (
          <EmptySection
            icon={CircleCheckIcon}
            title="No task finished lately"
            description="A task shows here with its outcome and its cost once it ends."
          />
        ) : (
          <FinishedTasksTable workers={finished} />
        )}
      </section>
    </div>
  )
}

export const Route = createFileRoute('/_app/')({
  staticData: { section: 'Overview', crumb: 'Now' },
  loader: ({ context }) => {
    return context.queryClient.query(listWorkersQueryOpts())
  },
  component: NowPage
})
