import { queryOptions } from '@tanstack/react-query'
import { getTicket } from '#/server/tickets.functions.ts'

export const getTicketQueryOpts = (
  key: string,
  workerActiveAt: number | undefined
) => {
  return queryOptions({
    queryKey: ['ticket', key, workerActiveAt ?? null],
    queryFn: () => {
      return getTicket({ data: { key } })
    },
    staleTime: Infinity
  })
}
