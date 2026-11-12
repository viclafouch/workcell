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
import { createLinearApi, LINEAR_GRAPHQL_URL } from './linear-api.ts'
import { createTicketPoller } from './ticket-poller.ts'

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

const TODO = { id: 'state-todo', type: 'unstarted' }

const IN_PROGRESS = { id: 'state-in-progress', type: 'started', position: 1 }

const IN_REVIEW = { id: 'state-in-review', type: 'started', position: 2 }

const STATES = [TODO, IN_PROGRESS, IN_REVIEW]

const RETRY_AFTER_SECONDS = 30

const MS_PER_SECOND = 1000

const REQUESTS_RESET_IN_MS = 90_000

const COMPLEXITY_RESET_LATER_MS = 3_000_000

const APP_TICKET = [READY_LABEL, 'repo:app']

type FakeTicket = {
  identifier: string
  labels: string[]
  state: { id: string; type: string }
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
      labels: z.object({
        some: z.object({ name: z.object({ in: z.array(z.string()) }) })
      })
    }),
    z.object({
      state: z.object({ type: z.object({ in: z.array(z.string()) }) })
    })
  ])
})

const callSchema = z.discriminatedUnion('operationName', [
  z.object({
    operationName: z.literal('ReadyTickets'),
    variables: z.object({ filter: filterSchema })
  }),
  z.object({
    operationName: z.literal('MoveTicket'),
    variables: z.object({ id: z.string(), stateId: z.string() })
  })
])

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
  const [ready, repository, state] = filter.and

  return (
    ticket.labels.includes(ready.labels.some.name.eq) &&
    ticket.labels.some((label) => {
      return repository.labels.some.name.in.includes(label)
    }) &&
    state.state.type.in.includes(ticket.state.type)
  )
}

function answerCall(call: z.infer<typeof callSchema>) {
  if (call.operationName === 'MoveTicket') {
    const { id, stateId } = call.variables
    const ticket = findTicket(id)
    const state = STATES.find((candidate) => {
      return candidate.id === stateId
    })

    if (ticket === undefined || state === undefined) {
      return { errors: [{ message: `No ticket ${id} or state ${stateId}.` }] }
    }

    ticket.state = state
    moves.push(`${ticket.identifier} → ${stateId}`)

    return { data: { issueUpdate: { success: true } } }
  }

  const nodes = tickets
    .filter((ticket) => {
      return matches(ticket, call.variables.filter)
    })
    .map(({ identifier, labels, state }) => {
      return {
        id: uuidOf(identifier),
        identifier,
        title: 'Fix the login',
        url: `https://linear.app/acme/issue/${identifier}`,
        state,
        labels: {
          nodes: labels.map((name) => {
            return { name }
          })
        },
        team: { states: { nodes: [IN_REVIEW, IN_PROGRESS] } }
      }
    })

  return { data: { issues: { nodes } } }
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
            { message: 'Slow down.', extensions: { code: 'RATELIMITED' } }
          ]
        },
        {
          status: 429,
          headers: rateLimitHeaders
        }
      )
    }

    return HttpResponse.json(answerCall(callSchema.parse(await request.json())))
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
    const reason = error instanceof Error ? ` ${error.message}` : ''
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

    await linear.readyTickets({
      readyLabel: READY_LABEL,
      repositoryLabels: Object.keys(INTAKE.repositoryLabels),
      stateTypes: ['backlog', 'unstarted']
    })
    const timersAfterTheCall = timersKeepingTheProcessAlive()
    linear[Symbol.dispose]()

    expect(timersAfterTheCall).toBeGreaterThan(timersBefore)
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

  it('starts at its first poll the worker of a ticket that a stopped host left In Progress', async () => {
    tickets = [{ identifier: 'TASK-7', labels: APP_TICKET, state: IN_PROGRESS }]
    const started: StartedWorker[] = []
    const stopped = new AbortController()
    const { poller } = openPoller(async (task) => {
      started.push({ task, stateAtStart: stateOf(task.subject) })
      stopped.abort()

      return { name: 'Alpha', isNew: true }
    })

    await poller.run(stopped.signal)

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
    vi.useFakeTimers({ toFake: ['Date'] })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const started: StartedWorker[] = []
    const { poller } = openPoller(recordStarts(started))

    await expect(poller.pollOnce()).rejects.toThrow(
      'Linear rate limits the Linear intake until'
    )
    vi.setSystemTime(Date.now() + RETRY_AFTER_SECONDS * MS_PER_SECOND - 1)
    await expect(poller.pollOnce()).rejects.toThrow(
      'Linear rate limits the Linear intake until'
    )

    expect(requests).toBe(1)

    vi.setSystemTime(Date.now() + 1)
    await poller.pollOnce()

    expect(started).toHaveLength(1)
  })

  it('calls Linear no more until the reset of its spent budget when Linear gives no Retry-After', async () => {
    tickets = [{ identifier: 'TASK-9', labels: APP_TICKET, state: TODO }]
    rateLimitedAnswers = 1
    vi.useFakeTimers({ toFake: ['Date'] })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const resetAt = Date.now() + REQUESTS_RESET_IN_MS
    rateLimitHeaders = new Headers({
      'x-ratelimit-requests-remaining': '0',
      'x-ratelimit-requests-reset': String(resetAt),
      'x-ratelimit-complexity-remaining': '2999000',
      'x-ratelimit-complexity-reset': String(
        resetAt + COMPLEXITY_RESET_LATER_MS
      )
    })
    const started: StartedWorker[] = []
    const { poller } = openPoller(recordStarts(started))

    await expect(poller.pollOnce()).rejects.toThrow(
      `Linear rate limits the Linear intake until ${new Date(resetAt).toISOString()}.`
    )
    vi.setSystemTime(resetAt - 1)
    await expect(poller.pollOnce()).rejects.toThrow(
      'Linear rate limits the Linear intake until'
    )

    expect(requests).toBe(1)

    vi.setSystemTime(resetAt)
    await poller.pollOnce()

    expect(started).toHaveLength(1)
  })
})
