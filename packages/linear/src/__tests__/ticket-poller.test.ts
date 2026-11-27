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
import {
  TEST_STARTER,
  timersKeepingTheProcessAlive
} from '@workcell/core/testing'
import { createLinearApi } from '#/linear-api.ts'
import {
  APP_TICKET,
  COMPLEXITY_RESET_LATER_MS,
  fakeLinear,
  IN_PROGRESS,
  LINEAR_API_KEY,
  openPoller,
  READY_LABEL,
  recordStarts,
  REQUESTS_RESET_IN_MS,
  RETRY_AFTER_SECONDS,
  roomFor,
  type StartedWorker,
  stateOf,
  TODO,
  network,
  resetFakeLinear,
  uuidOf
} from './fake-linear.ts'

describe('the ticket poller', () => {
  beforeAll(() => {
    network.listen({ onUnhandledFrame: 'error' })
  })

  beforeEach(resetFakeLinear)

  afterAll(() => {
    network.close()
  })

  it('moves a ready ticket to In Progress, then starts its worker with the ticket id as input id', async () => {
    fakeLinear.tickets = [
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
    fakeLinear.tickets = [
      { identifier: 'TASK-3', labels: ['repo:app'], state: TODO },
      { identifier: 'TASK-4', labels: [READY_LABEL, 'Bug'], state: TODO },
      { identifier: 'TASK-5', labels: APP_TICKET, state: IN_PROGRESS }
    ]
    const started: StartedWorker[] = []
    const { poller } = openPoller(recordStarts(started))

    await poller.pollOnce()

    expect(started).toStrictEqual([])
    expect(fakeLinear.moves).toStrictEqual([])
  })

  it('puts the ticket back and logs why when its worker fails to start, then leaves it until the next host start', async () => {
    fakeLinear.tickets = [
      { identifier: 'TASK-6', labels: APP_TICKET, state: TODO }
    ]
    const { poller, lines } = openPoller(
      roomFor(async () => {
        throw new Error('Alpha already works on TASK-6')
      })
    )

    await poller.pollOnce()
    await poller.pollOnce()

    expect(fakeLinear.moves).toStrictEqual([
      `TASK-6 → ${IN_PROGRESS.id}`,
      `TASK-6 → ${TODO.id}`
    ])
    expect(lines).toStrictEqual([
      'ticket not taken: it keeps its state, and the host tries it again at its next start {"ticket":"TASK-6"} Alpha already works on TASK-6'
    ])
  })

  it('lists the queue in the order of Linear, with the cause of a ticket that cannot start', async () => {
    fakeLinear.tickets = [
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

    const queue = await poller.tracker.queue()

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
      state: { name: 'Todo', category: 'open', color: '#e2e2e2' },
      labels: [{ name: READY_LABEL, color: '#5e6ad2' }],
      assignees: [{ name: 'Ada Lovelace', avatarUrl: undefined }],
      priority: 'Urgent',
      blocker: 'It needs a repository label: repo:app, repo:tooling.'
    })
    expect(poller.tracker.name).toBe('Linear')
  })

  it('starts the fakeLinear.tickets in the order of the queue, and each one it takes leaves the queue', async () => {
    fakeLinear.tickets = [
      { identifier: 'TASK-14', labels: APP_TICKET, state: TODO, priority: 4 },
      { identifier: 'TASK-15', labels: APP_TICKET, state: TODO, priority: 2 },
      { identifier: 'TASK-16', labels: [READY_LABEL], state: TODO }
    ]
    const started: StartedWorker[] = []
    const { poller } = openPoller(recordStarts(started))

    await poller.pollOnce()
    const queue = await poller.tracker.queue()

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
    fakeLinear.tickets = [
      { identifier: 'TASK-17', labels: APP_TICKET, state: TODO }
    ]
    const { poller } = openPoller(
      roomFor(async () => {
        throw new Error('The sandbox image is missing.')
      })
    )

    await poller.pollOnce()
    const queue = await poller.tracker.queue()

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
    fakeLinear.tickets = [
      { identifier: 'TASK-7', labels: APP_TICKET, state: IN_PROGRESS }
    ]
    const started: StartedWorker[] = []
    const firstStart = Promise.withResolvers<null>()
    const { poller } = openPoller(
      roomFor(async (task) => {
        started.push({ task, stateAtStart: stateOf(task.subject) })
        firstStart.resolve(null)

        return { name: 'Alpha', isNew: true }
      })
    )

    {
      await using polling = poller.start()
      await firstStart.promise
    }

    expect(
      started.map(({ task, stateAtStart }) => {
        return [task.inputId, stateAtStart]
      })
    ).toStrictEqual([[uuidOf('TASK-7'), IN_PROGRESS.id]])
    expect(fakeLinear.moves).toStrictEqual([])
  })
})

describe('the Linear API of the intake', () => {
  beforeAll(() => {
    network.listen({ onUnhandledFrame: 'error' })
  })

  beforeEach(resetFakeLinear)

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

  it('calls Linear no more until the Retry-After that Linear gives, then polls again', async () => {
    fakeLinear.tickets = [
      { identifier: 'TASK-8', labels: APP_TICKET, state: TODO }
    ]
    fakeLinear.rateLimitedAnswers = 1
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

    expect(fakeLinear.requests).toBe(1)

    vi.setSystemTime(Temporal.Now.instant().add({ milliseconds: 1 }))
    await poller.pollOnce()

    expect(started).toHaveLength(1)
  })

  it('calls Linear no more until the reset of its spent budget when Linear gives no Retry-After', async () => {
    fakeLinear.tickets = [
      { identifier: 'TASK-9', labels: APP_TICKET, state: TODO }
    ]
    fakeLinear.rateLimitedAnswers = 1
    vi.useFakeTimers({ toFake: ['Date', 'Temporal'] })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const resetAt = Temporal.Now.instant().add({
      milliseconds: REQUESTS_RESET_IN_MS
    })
    fakeLinear.rateLimitHeaders = new Headers({
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

    expect(fakeLinear.requests).toBe(1)

    vi.setSystemTime(resetAt)
    await poller.pollOnce()

    expect(started).toHaveLength(1)
  })
})
