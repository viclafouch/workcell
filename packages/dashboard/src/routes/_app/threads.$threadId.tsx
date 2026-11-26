import { createFileRoute } from '@tanstack/react-router'
import { SessionPanel } from '#/components/session/session-panel.tsx'
import { useIsThreadActive } from '#/hooks/use-host-status.ts'

const BotThreadPage = () => {
  const { threadId } = Route.useParams()
  const isThreadActive = useIsThreadActive('bot', threadId)

  return (
    <SessionPanel
      key={threadId}
      harness="bot"
      threadId={threadId}
      isThreadActive={isThreadActive}
      header={
        <h1 className="text-2xl leading-tight font-semibold sm:text-3xl">
          A thread with the bot
        </h1>
      }
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
