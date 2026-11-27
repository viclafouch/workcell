import {
  ActivityIcon,
  BotIcon,
  ChevronRightIcon,
  CircleCheckIcon
} from 'lucide-react'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '#/components/ui/collapsible.tsx'
import { FinishedTasksTable } from '#/components/worker/finished-tasks-table.tsx'
import { WorkerLanes } from '#/components/worker/worker-lanes.tsx'
import { groupWorkers } from '#/constants/worker-status.ts'
import { listBotThreadsQueryOpts } from '#/queries/bot-threads.ts'
import { listWorkersQueryOpts } from '#/queries/workers.ts'
import { BotThreads } from './-components/bot-threads.tsx'
import { EmptySection } from './-components/empty-section.tsx'
import { NowHeadline } from './-components/now-headline.tsx'
import { SectionHeading } from './-components/section-heading.tsx'

const NowPage = () => {
  const workersQuery = useSuspenseQuery(listWorkersQueryOpts())
  const botThreadsQuery = useQuery(listBotThreadsQueryOpts())
  const {
    needsYou = [],
    working = [],
    asleep = [],
    finished = []
  } = groupWorkers(workersQuery.data)

  return (
    <div className="mx-auto flex w-full max-w-panel flex-col gap-12 px-4 py-8 sm:px-6">
      <NowHeadline working={working} needsYou={needsYou} asleep={asleep} />
      {needsYou.length === 0 ? null : (
        <section
          aria-labelledby="needs-you-heading"
          className="flex flex-col gap-4"
        >
          <SectionHeading id="needs-you-heading">Needs you</SectionHeading>
          <WorkerLanes workers={needsYou} label="Workers that need you" />
        </section>
      )}
      <section
        aria-labelledby="working-heading"
        className="flex flex-col gap-4"
      >
        <SectionHeading id="working-heading">Working</SectionHeading>
        {working.length === 0 ? (
          <EmptySection
            icon={ActivityIcon}
            title="No worker works right now"
            description="A task handed to the bot starts a worker here."
          />
        ) : (
          <WorkerLanes workers={working} label="Working workers" />
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
          <BotThreads
            threads={botThreadsQuery.data}
            workers={workersQuery.data}
          />
        )}
      </section>
      {asleep.length === 0 ? null : (
        <Collapsible
          render={<section aria-labelledby="asleep-heading" />}
          className="group/asleep flex flex-col gap-4"
        >
          <h2 id="asleep-heading" className="text-lg font-semibold">
            <CollapsibleTrigger className="press inline-flex items-center gap-2 rounded-md">
              <ChevronRightIcon
                aria-hidden
                className="size-5 transition-transform duration-(--duration-fast) ease-(--ease-out-strong) group-data-[open]/asleep:rotate-90 motion-reduce:transition-none"
              />
              Asleep
              <span className="font-normal text-muted-foreground tabular">
                {asleep.length}
              </span>
            </CollapsibleTrigger>
          </h2>
          <CollapsibleContent hiddenUntilFound>
            <WorkerLanes workers={asleep} label="Asleep workers" />
          </CollapsibleContent>
        </Collapsible>
      )}
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
