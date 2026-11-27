import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'

const threadInputSchema = z.object({ threadId: z.string().min(1) })

export const listWorkers = createServerFn({ method: 'GET' }).handler(
  async ({ context }) => {
    const workers = await context.workers.view()

    return workers.map((worker) => {
      return { ...worker, traceUrl: context.traceUrl?.(worker.threadId) }
    })
  }
)

export const listWorkerIdentities = createServerFn({ method: 'GET' }).handler(
  ({ context }) => {
    return context.workerIdentities ?? []
  }
)

export const getWorkerDiff = createServerFn({ method: 'GET' })
  .validator(threadInputSchema)
  .handler(async ({ context, data }) => {
    return context.workers.diff(data.threadId)
  })
