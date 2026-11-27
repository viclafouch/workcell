import type { SessionViewState } from '@tanstack/ai-harness/view'
import { StatusPill } from '#/components/status/status-pill.tsx'
import type { WorkerStatus } from '#/constants/worker-status.ts'

type ConnectionStatusProps = {
  connection: SessionViewState['connection']
  status: SessionViewState['status']
}

const describe = ({
  connection,
  status
}: ConnectionStatusProps): WorkerStatus | null => {
  if (connection === 'reconnecting') {
    return {
      tone: 'waiting',
      label: 'Reconnecting',
      hint: 'The stream from the host dropped. The page connects again and goes on from the last event.'
    }
  }

  if (connection === 'open' && status !== 'idle') {
    return {
      tone: 'running',
      label: 'Live',
      hint: 'Each step shows here as the thread takes it.'
    }
  }

  return null
}

export const ConnectionStatus = (props: ConnectionStatusProps) => {
  const status = describe(props)

  return (
    <output>{status === null ? null : <StatusPill status={status} />}</output>
  )
}
