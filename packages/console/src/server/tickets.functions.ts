import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { TicketDetails } from '@workcell/core'

const ticketInputSchema = z.object({ key: z.string().min(1) })

export type TicketRead =
  | { tracker: string; ticket: TicketDetails | null }
  | { tracker: string; failure: string }

export const getTicket = createServerFn({ method: 'GET' })
  .validator(ticketInputSchema)
  .handler(async ({ context, data }): Promise<TicketRead | null> => {
    if (context.tracker === undefined) {
      return null
    }

    const { name: tracker, ticket } = context.tracker

    try {
      return { tracker, ticket: await ticket(data.key) }
    } catch (error) {
      context.logger.error(
        { error, tracker, key: data.key },
        'The tracker gave no ticket.'
      )

      return {
        tracker,
        failure: Error.isError(error) ? error.message : String(error)
      }
    }
  })
