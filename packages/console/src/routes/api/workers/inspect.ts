import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/workers/inspect')({
  server: {
    handlers: {
      GET: async ({ context }) => {
        return Response.json(await context.workers.inspect())
      }
    }
  }
})
