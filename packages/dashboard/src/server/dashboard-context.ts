import type { FeedbackReport, WorkerView } from '@workcell/core'

export const HARNESS_NAMES = ['worker', 'bot'] as const

export type HarnessName = (typeof HARNESS_NAMES)[number]

export type DashboardBrand = {
  name: string
  stylesheetUrl?: string
  logoUrl?: string
}

export type DashboardLogger = {
  error: (bindings: object, message: string) => void
}

export type DashboardContext = {
  brand: DashboardBrand
  logger: DashboardLogger
  harness: Record<HarnessName, (request: Request) => Promise<Response>>
  workers: {
    view: () => Promise<WorkerView[]>
    inspect: () => Promise<WorkerView[]>
    diff: (threadId: string) => Promise<string | null>
  }
  feedback: {
    recent: () => FeedbackReport[] | Promise<FeedbackReport[]>
  }
  traceUrl?: (threadId: string) => string
}
