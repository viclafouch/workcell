import { StatusDot } from '#/components/worker/status-dot.tsx'
import { useHostStatus } from '#/hooks/use-host-status.ts'

const LABELS = {
  running: 'The bot is answering',
  waiting: 'The bot waits for someone'
} as const

type BotThreadStatusProps = {
  threadId: string
}

export const BotThreadStatus = ({ threadId }: BotThreadStatusProps) => {
  const hostStatusQuery = useHostStatus('bot')
  const status = hostStatusQuery.data?.get(threadId)

  if (status !== 'running' && status !== 'waiting') {
    return null
  }

  return (
    <span
      title={LABELS[status]}
      className="grid size-4 shrink-0 place-items-center"
    >
      <StatusDot tone={status} />
      <span className="sr-only">{LABELS[status]}</span>
    </span>
  )
}
