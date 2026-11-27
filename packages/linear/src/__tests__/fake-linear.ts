import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import { z } from 'zod'
import { NoFreePlaceError, type WorkerTask } from '@workcell/core'
import { TEST_STARTER } from '@workcell/core/testing'
import { createLinearApi, LINEAR_GRAPHQL_URL } from '#/linear-api.ts'
import { createTicketPoller } from '#/ticket-poller.ts'

export const LINEAR_API_KEY = 'lin_api_intake_test_key'

export const READY_LABEL = 'agent-ready'

const INTAKE = {
  readyLabel: READY_LABEL,
  repositoryLabels: {
    'repo:app': 'acme/app',
    'repo:tooling': 'acme/tooling'
  },
  pollIntervalMs: 60_000
}

export const TODO = {
  id: 'state-todo',
  name: 'Todo',
  type: 'unstarted',
  position: 0
}

export const IN_PROGRESS = {
  id: 'state-in-progress',
  name: 'In Progress',
  type: 'started',
  position: 1
}

const IN_REVIEW = {
  id: 'state-in-review',
  name: 'In Review',
  type: 'started',
  position: 2
}

const STATES = [TODO, IN_PROGRESS, IN_REVIEW]

const PRIORITY_LABELS = ['No priority', 'Urgent', 'High', 'Medium', 'Low']

const NO_PRIORITY = 0

const PRIORITY_SORT = [{ priority: { order: 'Descending' } }]

export const RETRY_AFTER_SECONDS = 30

export const REQUESTS_RESET_IN_MS = 90_000

export const COMPLEXITY_RESET_LATER_MS = 3_000_000

export const APP_TICKET = [READY_LABEL, 'repo:app']

type FakeTicket = {
  identifier: string
  labels: string[]
  state: (typeof STATES)[number]
  priority?: number
  assignee?: { name: string; avatarUrl: string | null }
}

export type StartedWorker = {
  task: WorkerTask
  stateAtStart: string | undefined
}

type FakeLinear = {
  tickets: FakeTicket[]
  moves: string[]
  rateLimitedAnswers: number
  requests: number
  rateLimitHeaders: Headers
}

export const fakeLinear: FakeLinear = {
  tickets: [],
  moves: [],
  rateLimitedAnswers: 0,
  requests: 0,
  rateLimitHeaders: new Headers()
}

export function resetFakeLinear() {
  fakeLinear.tickets = []
  fakeLinear.moves = []
  fakeLinear.rateLimitedAnswers = 0
  fakeLinear.requests = 0
  fakeLinear.rateLimitHeaders = new Headers({
    'retry-after': String(RETRY_AFTER_SECONDS)
  })
}

const filterSchema = z.object({
  and: z.tuple([
    z.object({
      labels: z.object({
        some: z.object({ name: z.object({ eq: z.string() }) })
      })
    }),
    z.object({
      state: z.object({ type: z.object({ in: z.array(z.string()) }) })
    })
  ])
})

const OPERATION_NAME = /(?:query|mutation) (?<name>\w+)/u

const LAST_PAGE = { hasNextPage: false, endCursor: null }

const callSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('labelledTickets'),
    variables: z.object({
      filter: filterSchema,
      sort: z.unknown(),
      startedState: z.object({ type: z.object({ eq: z.string() }) })
    })
  }),
  z.object({
    operation: z.literal('updateIssue'),
    variables: z.object({
      id: z.string(),
      input: z.object({ stateId: z.string() })
    })
  })
])

const requestSchema = z.object({
  query: z.string(),
  variables: z.record(z.string(), z.unknown()).default({})
})

export function uuidOf(identifier: string | undefined) {
  return `uuid-of-${identifier}`
}

function findTicket(id: string) {
  return fakeLinear.tickets.find(({ identifier }) => {
    return uuidOf(identifier) === id
  })
}

function matches(ticket: FakeTicket, filter: z.infer<typeof filterSchema>) {
  const [ready, state] = filter.and

  return (
    ticket.labels.includes(ready.labels.some.name.eq) &&
    state.state.type.in.includes(ticket.state.type)
  )
}

function urgencyOf({ priority = NO_PRIORITY }: FakeTicket) {
  return priority === NO_PRIORITY ? Infinity : priority
}

function inLinearOrder(sort: unknown, matching: FakeTicket[]) {
  return JSON.stringify(sort) === JSON.stringify(PRIORITY_SORT)
    ? matching.toSorted((left, right) => {
        return urgencyOf(left) - urgencyOf(right)
      })
    : matching.toReversed()
}

function answerCall(call: z.infer<typeof callSchema>) {
  if (call.operation === 'updateIssue') {
    const { id } = call.variables
    const { stateId } = call.variables.input
    const ticket = findTicket(id)
    const state = STATES.find((candidate) => {
      return candidate.id === stateId
    })

    if (ticket === undefined || state === undefined) {
      return { errors: [{ message: `No ticket ${id} or state ${stateId}.` }] }
    }

    ticket.state = state
    fakeLinear.moves.push(`${ticket.identifier} → ${stateId}`)

    return { data: { issueUpdate: { success: true, lastSyncId: 1 } } }
  }

  const matching = fakeLinear.tickets.filter((ticket) => {
    return matches(ticket, call.variables.filter)
  })
  const nodes = inLinearOrder(call.variables.sort, matching).map(
    ({ identifier, labels, state, priority = NO_PRIORITY, assignee }) => {
      return {
        id: uuidOf(identifier),
        identifier,
        title: 'Fix the login',
        url: `https://linear.app/acme/issue/${identifier}`,
        priority,
        priorityLabel: PRIORITY_LABELS[priority],
        state: { id: state.id, name: state.name, type: state.type },
        labels: {
          nodes: labels.map((name) => {
            return { name, color: '#5e6ad2' }
          })
        },
        assignee: assignee ?? null,
        team: {
          states: {
            nodes: STATES.filter(({ type }) => {
              return type === call.variables.startedState.type.eq
            })
          }
        }
      }
    }
  )

  return { data: { issues: { nodes, pageInfo: LAST_PAGE } } }
}

export const network = setupServer(
  http.post(LINEAR_GRAPHQL_URL, async ({ request }) => {
    fakeLinear.requests += 1

    if (request.headers.get('authorization') !== LINEAR_API_KEY) {
      return HttpResponse.json(
        { errors: [{ message: 'No key.' }] },
        { status: 401 }
      )
    }

    if (fakeLinear.rateLimitedAnswers > 0) {
      fakeLinear.rateLimitedAnswers -= 1

      return HttpResponse.json(
        {
          errors: [
            {
              message: 'Slow down.',
              extensions: { type: 'ratelimited', code: 'RATELIMITED' }
            }
          ]
        },
        {
          status: 429,
          headers: fakeLinear.rateLimitHeaders
        }
      )
    }

    const { query, variables } = requestSchema.parse(await request.json())

    return HttpResponse.json(
      answerCall(
        callSchema.parse({
          operation: OPERATION_NAME.exec(query)?.groups?.name,
          variables
        })
      )
    )
  })
)

export function stateOf(identifier: string | undefined) {
  return findTicket(uuidOf(identifier))?.state.id
}

type StartWorker = (
  workerTask: WorkerTask
) => Promise<{ name: string; isNew: boolean }>

type PollerWorkers = {
  startWorker: StartWorker
  freePlaces: () => Promise<number>
  onPlaceFree: (listener: () => void) => () => void
}

export function roomFor(startWorker: StartWorker): PollerWorkers {
  return {
    startWorker,
    freePlaces: async () => {
      return Infinity
    },
    onPlaceFree: () => {
      return () => {}
    }
  }
}

export function workersWithCapacity(capacity: number) {
  const live = new Map<string, string>()
  const everStarted = new Set<string>()
  const started: string[] = []
  const listeners = new Set<() => void>()
  const firstStart = Promise.withResolvers<null>()
  let nextStart = Promise.withResolvers<null>()

  const workers: PollerWorkers = {
    startWorker: async ({ subject = '', inputId = '' }) => {
      if (everStarted.has(inputId)) {
        return { name: subject, isNew: false }
      }

      if (live.size >= capacity) {
        throw new NoFreePlaceError(capacity, [...live.values()])
      }

      live.set(inputId, subject)
      everStarted.add(inputId)
      started.push(subject)
      firstStart.resolve(null)
      nextStart.resolve(null)

      return { name: subject, isNew: true }
    },
    freePlaces: async () => {
      return capacity - live.size
    },
    onPlaceFree: (listener) => {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    }
  }

  return {
    workers,
    started,
    live: () => {
      return [...live.values()]
    },
    firstStart: firstStart.promise,
    nextStart: () => {
      nextStart = Promise.withResolvers<null>()

      return nextStart.promise
    },
    finish: (subject: string) => {
      live.delete(uuidOf(subject))

      for (const listener of listeners) {
        listener()
      }
    }
  }
}

export function openPoller(workers: PollerWorkers) {
  const lines: string[] = []
  const record = (
    { error, ...details }: Record<string, unknown>,
    message: string
  ) => {
    const reason = Error.isError(error) ? ` ${error.message}` : ''
    lines.push(`${message} ${JSON.stringify(details)}${reason}`)
  }
  const poller = createTicketPoller({
    linear: createLinearApi(LINEAR_API_KEY),
    workers,
    starter: TEST_STARTER,
    ...INTAKE,
    logger: { info: record, error: record }
  })

  return { poller, lines }
}

export function recordStarts(started: StartedWorker[]) {
  return roomFor(async (task: WorkerTask) => {
    started.push({ task, stateAtStart: stateOf(task.subject) })

    return { name: 'Alpha', isNew: true }
  })
}

export function fiveWaitingTickets() {
  return ['TASK-20', 'TASK-21', 'TASK-22', 'TASK-23', 'TASK-24'].map(
    (identifier, index) => {
      return {
        identifier,
        labels: APP_TICKET,
        state: TODO,
        priority: index + 1
      }
    }
  )
}

export async function keysInQueue(
  poller: ReturnType<typeof createTicketPoller>
) {
  const queue = await poller.queue.read()

  return queue.map(({ key }) => {
    return key
  })
}
