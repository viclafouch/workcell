import { createServerFn } from '@tanstack/react-start'

export const getIntegrationMarks = createServerFn({ method: 'GET' }).handler(
  ({ context }) => {
    return {
      tracker: context.tracker?.mark ?? null,
      pullRequests: context.pullRequests?.mark ?? null
    }
  }
)
