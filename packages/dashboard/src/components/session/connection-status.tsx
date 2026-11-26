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
}: ConnectionStatusProps): WorkerStatus => {
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

  return {
    tone: 'idle',
    label: 'Not streaming',
    hint: 'The thread sleeps, so the page holds no stream to the host. It opens one again when the thread wakes up.'
  }
}

export const ConnectionStatus = (props: ConnectionStatusProps) => {
  return (
    <output>
      <StatusPill status={describe(props)} />
    </output>
  )
}
