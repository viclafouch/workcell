import type {
  FeedbackReport,
  PullRequests,
  Tracker,
  WorkerView
} from '@workcell/core'

export const HARNESS_NAMES = ['worker', 'bot'] as const

export type HarnessName = (typeof HARNESS_NAMES)[number]

export type ConsoleBrand = {
  name: string
  logoUrl?: string
}

export type ChatMark = {
  adapter: string
  name: string
  iconUrl: string
}

export type ChatPerson = {
  userId: string
  name: string
  avatarUrl?: string
}

export type ChatThreadMessage = {
  inputId: string
  authorId: string
  sentAt: number
  isMe: boolean
  text: string
}

export type ChatThreadDetails = {
  place: { name?: string; isDM: boolean; isPrivate: boolean; url?: string }
  workspace?: { name: string; url: string }
  threadUrl?: string
  people: readonly ChatPerson[]
  messages: readonly ChatThreadMessage[]
}

export type ConsoleChat = ChatMark & {
  bot?: () => Promise<ChatPerson | null>
  describe?: (threadId: string) => Promise<ChatThreadDetails>
}

export type WorkerIdentity = {
  name: string
  iconUrl?: string
}

export type ConsoleLogger = {
  error: (bindings: object, message: string) => void
}

export type ConsoleContext = {
  brand: ConsoleBrand
  chats?: readonly ConsoleChat[]
  workerIdentities?: readonly WorkerIdentity[]
  logger: ConsoleLogger
  harness: Record<HarnessName, (request: Request) => Promise<Response>>
  workers: {
    capacity: number
    view: () => Promise<WorkerView[]>
    inspect: () => Promise<WorkerView[]>
    diff: (threadId: string) => Promise<string | null>
  }
  feedback: {
    recent: () => FeedbackReport[] | Promise<FeedbackReport[]>
  }
  tracker?: Tracker
  pullRequests?: PullRequests
  traceUrl?: (threadId: string) => string
}
