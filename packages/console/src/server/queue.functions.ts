import { createServerFn } from '@tanstack/react-start'
import type { QueuedTicket } from '@workcell/core'

export type QueueRead =
  | { tracker: string; tickets: QueuedTicket[] }
  | { tracker: string; failure: string }

export const getQueue = createServerFn({ method: 'GET' }).handler(
  async ({ context }): Promise<QueueRead | null> => {
    if (context.queue === undefined) {
      return null
    }

    const { tracker, read } = context.queue

    try {
      return { tracker, tickets: await read() }
    } catch (error) {
      context.logger.error({ error, tracker }, 'The tracker gave no queue.')

      return {
        tracker,
        failure: Error.isError(error) ? error.message : String(error)
      }
    }
  }
)
