import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { FeedbackList } from '#/components/feedback/feedback-list.tsx'
import { listFeedbackQueryOpts } from '#/queries/feedback.ts'

const FeedbackPage = () => {
  const feedbackQuery = useSuspenseQuery(listFeedbackQueryOpts())

  return (
    <div className="mx-auto flex w-full max-w-panel flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl leading-tight font-semibold">
          What got in their way
        </h1>
        <p className="max-w-measure text-muted-foreground">
          Each report is a tool, a skill or a limit that an agent hit during a
          task.
        </p>
      </div>
      <div className="rounded-xl border bg-card px-4">
        <FeedbackList reports={feedbackQuery.data} showsThread />
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_app/feedback')({
  staticData: { section: 'Overview', crumb: 'Feedback' },
  loader: ({ context }) => {
    return context.queryClient.query(listFeedbackQueryOpts())
  },
  head: () => {
    return { meta: [{ title: 'Feedback of the agents' }] }
  },
  component: FeedbackPage
})
