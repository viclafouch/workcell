import { useQuery } from '@tanstack/react-query'
import { StatusPill } from '#/components/status/status-pill.tsx'
import type { WorkerStatus } from '#/constants/worker-status.ts'
import {
  getHostConnectionQueryOpts,
  type HostConnection as Connection
} from '#/queries/host-status.ts'

const CONNECTION_STATUSES = {
  connecting: {
    tone: 'waiting',
    label: 'Connecting',
    hint: 'The page opens its stream to the host.'
  },
  open: {
    tone: 'success',
    label: 'Host connected',
    hint: 'The page hears each status change of the host, and refreshes the lists on its own.'
  },
  lost: {
    tone: 'failed',
    label: 'Host unreachable',
    hint: 'The page lost the host. It tries again on its own, and refreshes the lists once the host answers.'
  }
} as const satisfies Record<Connection, WorkerStatus>

export const HostConnection = () => {
  const connectionQuery = useQuery(getHostConnectionQueryOpts('worker'))

  return (
    <output>
      <StatusPill
        status={CONNECTION_STATUSES[connectionQuery.data ?? 'connecting']}
      />
    </output>
  )
}
