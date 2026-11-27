import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi
} from 'vitest'
import { z } from 'zod'
import type { WorkerTask } from '@workcell/core'
import {
  TEST_STARTER,
  timersKeepingTheProcessAlive
} from '@workcell/core/testing'
import { createLinearApi, LINEAR_GRAPHQL_URL } from '#/linear-api.ts'
import { createTicketPoller } from '#/ticket-poller.ts'

const LINEAR_API_KEY = 'lin_api_intake_test_key'

const READY_LABEL = 'agent-ready'

const INTAKE = {
  readyLabel: READY_LABEL,
  repositoryLabels: {
    'repo:app': 'acme/app',
    'repo:tooling': 'acme/tooling'
  },
  pollIntervalMs: 60_000
}

const TODO = { id: 'state-todo', name: 'Todo', type: 'unstarted', position: 0 }

const IN_PROGRESS = {
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

const PRIORITY_SORT = /sort: \[\{ priority: \{ order: Descending \} \}\]/u

const RETRY_AFTER_SECONDS = 30

const REQUESTS_RESET_IN_MS = 90_000

const COMPLEXITY_RESET_LATER_MS = 3_000_000

const APP_TICKET = [READY_LABEL, 'repo:app']

type FakeTicket = {
  identifier: string
  labels: string[]
  state: (typeof STATES)[number]
  priority?: number
  assignee?: { name: string; avatarUrl: string | null }
}

type StartedWorker = { task: WorkerTask; stateAtStart: string | undefined }

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
    query: z.string(),
    variables: z.object({ filter: filterSchema })
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

let tickets: FakeTicket[]

let moves: string[]

let rateLimitedAnswers: number

let requests: number

let rateLimitHeaders: Headers

function uuidOf(identifier: string | undefined) {
  return `uuid-of-${identifier}`
}

function findTicket(id: string) {
  return tickets.find(({ identifier }) => {
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

function inLinearOrder(query: string, matching: FakeTicket[]) {
  return PRIORITY_SORT.test(query)
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
    moves.push(`${ticket.identifier} → ${stateId}`)

    return { data: { issueUpdate: { success: true, lastSyncId: 1 } } }
  }

  const matching = tickets.filter((ticket) => {
    return matches(ticket, call.variables.filter)
  })
  const nodes = inLinearOrder(call.query, matching).map(
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
              return type === 'started'
            })
          }
        }
      }
    }
  )

  return { data: { issues: { nodes, pageInfo: LAST_PAGE } } }
}

const network = setupServer(
  http.post(LINEAR_GRAPHQL_URL, async ({ request }) => {
    requests += 1

    if (request.headers.get('authorization') !== LINEAR_API_KEY) {
      return HttpResponse.json(
        { errors: [{ message: 'No key.' }] },
        { status: 401 }
      )
    }

    if (rateLimitedAnswers > 0) {
      rateLimitedAnswers -= 1

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
          headers: rateLimitHeaders
        }
      )
    }

    const { query, variables } = requestSchema.parse(await request.json())

    return HttpResponse.json(
      answerCall(
        callSchema.parse({
          operation: OPERATION_NAME.exec(query)?.groups?.name,
          query,
          variables
        })
      )
    )
  })
)

function stateOf(identifier: string | undefined) {
  return findTicket(uuidOf(identifier))?.state.id
}

function openPoller(
  startWorker: (
    workerTask: WorkerTask
  ) => Promise<{ name: string; isNew: boolean }>
) {
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
    startWorker,
    starter: TEST_STARTER,
    ...INTAKE,
    logger: { info: record, error: record }
  })

  return { poller, lines }
}

function recordStarts(started: StartedWorker[]) {
  return async (task: WorkerTask) => {
    started.push({ task, stateAtStart: stateOf(task.subject) })

    return { name: 'Alpha', isNew: true }
  }
}

describe('the ticket poller', () => {
  beforeAll(() => {
    network.listen({ onUnhandledFrame: 'error' })
  })

  beforeEach(() => {
    tickets = []
    moves = []
    rateLimitedAnswers = 0
    requests = 0
    rateLimitHeaders = new Headers({
      'retry-after': String(RETRY_AFTER_SECONDS)
    })
  })

  afterAll(() => {
    network.close()
  })

  it('leaves no timer behind once its Linear API is disposed', async () => {
    const timersBefore = timersKeepingTheProcessAlive()
    const linear = createLinearApi(LINEAR_API_KEY)

    await linear.labelledTickets({
      readyLabel: READY_LABEL,
      stateTypes: ['backlog', 'unstarted']
    })
    linear[Symbol.dispose]()

    expect(timersKeepingTheProcessAlive()).toBeLessThanOrEqual(timersBefore)
  })

  it('moves a ready ticket to In Progress, then starts its worker with the ticket id as input id', async () => {
    tickets = [
      { identifier: 'TASK-1', labels: APP_TICKET, state: TODO },
      {
        identifier: 'TASK-2',
        labels: ['repo:tooling', READY_LABEL],
        state: TODO
      }
    ]
    const started: StartedWorker[] = []
    const { poller } = openPoller(recordStarts(started))

    await poller.pollOnce()

    expect(
      started.map(({ task }) => {
        return task
      })[0]
    ).toStrictEqual({
      starter: TEST_STARTER,
      repository: 'acme/app',
      task: 'Take the Linear ticket TASK-1 "Fix the login" (https://linear.app/acme/issue/TASK-1) to a pull request on acme/app.',
      subject: 'TASK-1',
      inputId: uuidOf('TASK-1')
    })
    expect(
      started.map(({ task, stateAtStart }) => {
        return [task.subject, task.repository, stateAtStart]
      })
    ).toStrictEqual([
      ['TASK-1', 'acme/app', IN_PROGRESS.id],
      ['TASK-2', 'acme/tooling', IN_PROGRESS.id]
    ])
  })

  it('leaves alone a ticket without the ready label, without a repository label, or already started', async () => {
    tickets = [
      { identifier: 'TASK-3', labels: ['repo:app'], state: TODO },
      { identifier: 'TASK-4', labels: [READY_LABEL, 'Bug'], state: TODO },
      { identifier: 'TASK-5', labels: APP_TICKET, state: IN_PROGRESS }
    ]
    const started: StartedWorker[] = []
    const { poller } = openPoller(recordStarts(started))

    await poller.pollOnce()

    expect(started).toStrictEqual([])
    expect(moves).toStrictEqual([])
  })

  it('puts the ticket back and logs why when its worker fails to start, then leaves it until the next host start', async () => {
    tickets = [{ identifier: 'TASK-6', labels: APP_TICKET, state: TODO }]
    const { poller, lines } = openPoller(async () => {
      throw new Error('Alpha already works on TASK-6')
    })

    await poller.pollOnce()
    await poller.pollOnce()

    expect(moves).toStrictEqual([
      `TASK-6 → ${IN_PROGRESS.id}`,
      `TASK-6 → ${TODO.id}`
    ])
    expect(lines).toStrictEqual([
      'ticket not taken: it keeps its state, and the host tries it again at its next start {"ticket":"TASK-6"} Alpha already works on TASK-6'
    ])
  })

  it('lists the queue in the order of Linear, with the cause of a ticket that cannot start', async () => {
    tickets = [
      { identifier: 'TASK-10', labels: APP_TICKET, state: TODO, priority: 3 },
      {
        identifier: 'TASK-11',
        labels: [READY_LABEL],
        state: TODO,
        priority: 1,
        assignee: { name: 'Ada Lovelace', avatarUrl: null }
      },
      { identifier: 'TASK-12', labels: APP_TICKET, state: TODO },
      { identifier: 'TASK-13', labels: APP_TICKET, state: IN_PROGRESS }
    ]
    const { poller } = openPoller(recordStarts([]))

    const queue = await poller.queue.read()

    expect(
      queue.map(({ key, priority, blocker }) => {
        return [key, priority, blocker]
      })
    ).toStrictEqual([
      [
        'TASK-11',
        'Urgent',
        'It needs a repository label: repo:app, repo:tooling.'
      ],
      ['TASK-10', 'Medium', undefined],
      ['TASK-12', undefined, undefined]
    ])
    expect(queue[0]).toStrictEqual({
      key: 'TASK-11',
      title: 'Fix the login',
      url: 'https://linear.app/acme/issue/TASK-11',
      state: { name: 'Todo', category: 'open' },
      labels: [{ name: READY_LABEL, color: '#5e6ad2' }],
      assignees: [{ name: 'Ada Lovelace', avatarUrl: undefined }],
      priority: 'Urgent',
      blocker: 'It needs a repository label: repo:app, repo:tooling.'
    })
    expect(poller.queue.tracker).toBe('Linear')
  })

  it('starts the tickets in the order of the queue, and each one it takes leaves the queue', async () => {
    tickets = [
      { identifier: 'TASK-14', labels: APP_TICKET, state: TODO, priority: 4 },
      { identifier: 'TASK-15', labels: APP_TICKET, state: TODO, priority: 2 },
      { identifier: 'TASK-16', labels: [READY_LABEL], state: TODO }
    ]
    const started: StartedWorker[] = []
    const { poller } = openPoller(recordStarts(started))

    await poller.pollOnce()
    const queue = await poller.queue.read()

    expect(
      started.map(({ task }) => {
        return task.subject
      })
    ).toStrictEqual(['TASK-15', 'TASK-14'])
    expect(
      queue.map(({ key }) => {
        return key
      })
    ).toStrictEqual(['TASK-16'])
  })

  it('keeps in the queue a ticket whose worker failed to start, with the cause', async () => {
    tickets = [{ identifier: 'TASK-17', labels: APP_TICKET, state: TODO }]
    const { poller } = openPoller(async () => {
      throw new Error('The sandbox image is missing.')
    })

    await poller.pollOnce()
    const queue = await poller.queue.read()

    expect(
      queue.map(({ key, blocker }) => {
        return [key, blocker]
      })
    ).toStrictEqual([
      [
        'TASK-17',
        'Its worker failed to start, and the host tries again at its next start: The sandbox image is missing.'
      ]
    ])
  })

  it('starts at its first poll the worker of a ticket that a stopped host left In Progress', async () => {
    tickets = [{ identifier: 'TASK-7', labels: APP_TICKET, state: IN_PROGRESS }]
    const started: StartedWorker[] = []
    const firstStart = Promise.withResolvers<null>()
    const { poller } = openPoller(async (task) => {
      started.push({ task, stateAtStart: stateOf(task.subject) })
      firstStart.resolve(null)

      return { name: 'Alpha', isNew: true }
    })

    {
      await using polling = poller.start()
      await firstStart.promise
    }

    expect(
      started.map(({ task, stateAtStart }) => {
        return [task.inputId, stateAtStart]
      })
    ).toStrictEqual([[uuidOf('TASK-7'), IN_PROGRESS.id]])
    expect(moves).toStrictEqual([])
  })

  it('calls Linear no more until the Retry-After that Linear gives, then polls again', async () => {
    tickets = [{ identifier: 'TASK-8', labels: APP_TICKET, state: TODO }]
    rateLimitedAnswers = 1
    vi.useFakeTimers({ toFake: ['Date', 'Temporal'] })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const started: StartedWorker[] = []
    const { poller } = openPoller(recordStarts(started))

    await expect(poller.pollOnce()).rejects.toThrow(
      'Linear rate limits the Linear intake until'
    )
    vi.setSystemTime(
      Temporal.Now.instant()
        .add({ seconds: RETRY_AFTER_SECONDS })
        .subtract({ milliseconds: 1 })
    )
    await expect(poller.pollOnce()).rejects.toThrow(
      'Linear rate limits the Linear intake until'
    )

    expect(requests).toBe(1)

    vi.setSystemTime(Temporal.Now.instant().add({ milliseconds: 1 }))
    await poller.pollOnce()

    expect(started).toHaveLength(1)
  })

  it('calls Linear no more until the reset of its spent budget when Linear gives no Retry-After', async () => {
    tickets = [{ identifier: 'TASK-9', labels: APP_TICKET, state: TODO }]
    rateLimitedAnswers = 1
    vi.useFakeTimers({ toFake: ['Date', 'Temporal'] })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const resetAt = Temporal.Now.instant().add({
      milliseconds: REQUESTS_RESET_IN_MS
    })
    rateLimitHeaders = new Headers({
      'x-ratelimit-requests-remaining': '0',
      'x-ratelimit-requests-reset': String(resetAt.epochMilliseconds),
      'x-ratelimit-complexity-remaining': '2999000',
      'x-ratelimit-complexity-reset': String(
        resetAt.add({ milliseconds: COMPLEXITY_RESET_LATER_MS })
          .epochMilliseconds
      )
    })
    const started: StartedWorker[] = []
    const { poller } = openPoller(recordStarts(started))

    await expect(poller.pollOnce()).rejects.toThrow(
      `Linear rate limits the Linear intake until ${resetAt.toString({ smallestUnit: 'millisecond' })}.`
    )
    vi.setSystemTime(resetAt.subtract({ milliseconds: 1 }))
    await expect(poller.pollOnce()).rejects.toThrow(
      'Linear rate limits the Linear intake until'
    )

    expect(requests).toBe(1)

    vi.setSystemTime(resetAt)
    await poller.pollOnce()

    expect(started).toHaveLength(1)
  })
})
