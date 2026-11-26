import { StatusPill } from '#/components/status/status-pill.tsx'
import type { WorkerStatus } from '#/constants/worker-status.ts'
import { useHostStatus } from '#/hooks/use-host-status.ts'

const describe = (isError: boolean, isStreaming: boolean): WorkerStatus => {
  if (isError) {
    return {
      tone: 'failed',
      label: 'Host unreachable',
      hint: 'The page lost the host. Check that the host runs: the page tries again on its own.'
    }
  }

  return isStreaming
    ? {
        tone: 'success',
        label: 'Host connected',
        hint: 'The page hears each status change of the host, and refreshes the lists on its own.'
      }
    : {
        tone: 'waiting',
        label: 'Connecting',
        hint: 'The page opens its stream to the host.'
      }
}

export const HostConnection = () => {
  const hostStatusQuery = useHostStatus('worker')

  return (
    <output>
      <StatusPill
        status={describe(
          hostStatusQuery.isError,
          hostStatusQuery.fetchStatus === 'fetching' ||
            hostStatusQuery.isSuccess
        )}
      />
    </output>
  )
}
