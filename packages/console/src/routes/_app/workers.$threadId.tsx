import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { PullRequestPanel } from '#/components/pull-request/pull-request-panel.tsx'
import { SessionPanel } from '#/components/session/session-panel.tsx'
import { TicketPanel } from '#/components/ticket/ticket-panel.tsx'
import { useIsThreadActive } from '#/hooks/use-host-status.ts'
import { openSessionView } from '#/lib/session-views.ts'
import { listWorkersQueryOpts } from '#/queries/workers.ts'
import { WorkerHeader } from './-components/worker-header.tsx'

const WorkerPage = () => {
  const { threadId } = Route.useParams()
  const workersQuery = useSuspenseQuery(listWorkersQueryOpts())
  const isThreadActive = useIsThreadActive('worker', threadId)
  const worker = workersQuery.data.find((candidate) => {
    return candidate.threadId === threadId
  })

  if (worker === undefined) {
    return null
  }

  return (
    <SessionPanel
      key={threadId}
      harness="worker"
      threadId={threadId}
      isThreadActive={isThreadActive}
      agentName={worker.name}
      header={<WorkerHeader worker={worker} />}
      ticket={
        <TicketPanel
          subject={worker.subject}
          workerActiveAt={worker.lastActiveAt}
        />
      }
      pullRequest={
        <PullRequestPanel
          repository={worker.repository}
          url={worker.pullRequest}
          revision={worker.pullRequestRevision}
          branch={worker.branch}
        />
      }
    />
  )
}

export const Route = createFileRoute('/_app/workers/$threadId')({
  staticData: { section: 'Workers' },
  loader: async ({ context, params }) => {
    openSessionView({ harness: 'worker', threadId: params.threadId })
    const workers = await context.queryClient.query(listWorkersQueryOpts())
    const worker = workers.find(({ threadId }) => {
      return threadId === params.threadId
    })

    if (worker === undefined) {
      throw notFound()
    }

    return { crumb: worker.name }
  },
  head: ({ loaderData }) => {
    return { meta: [{ title: loaderData?.crumb ?? 'Worker' }] }
  },
  component: WorkerPage
})
