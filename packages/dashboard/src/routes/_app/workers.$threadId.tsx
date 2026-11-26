import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { SessionPanel } from '#/components/session/session-panel.tsx'
import { useIsThreadActive } from '#/hooks/use-host-status.ts'
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
      header={<WorkerHeader worker={worker} />}
    />
  )
}

export const Route = createFileRoute('/_app/workers/$threadId')({
  staticData: { section: 'Workers' },
  loader: async ({ context, params }) => {
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
