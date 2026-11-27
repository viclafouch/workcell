import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import {
  APP_TICKET,
  fakeLinear,
  fiveWaitingTickets,
  IN_PROGRESS,
  keysInQueue,
  openPoller,
  TODO,
  network,
  resetFakeLinear,
  workersWithCapacity
} from './fake-linear.ts'

describe('the ticket poller under a capacity', () => {
  beforeAll(() => {
    network.listen({ onUnhandledFrame: 'error' })
  })

  beforeEach(resetFakeLinear)

  afterAll(() => {
    network.close()
  })

  it('runs as many workers as the capacity, and keeps the other fakeLinear.tickets in the queue, untouched', async () => {
    fakeLinear.tickets = fiveWaitingTickets()
    const capacity = workersWithCapacity(2)
    const { poller } = openPoller(capacity.workers)

    await expect(poller.pollOnce()).resolves.toBe('full')

    expect(capacity.started).toStrictEqual(['TASK-20', 'TASK-21'])
    expect(fakeLinear.moves).toStrictEqual([
      `TASK-20 → ${IN_PROGRESS.id}`,
      `TASK-21 → ${IN_PROGRESS.id}`
    ])
    await expect(keysInQueue(poller)).resolves.toStrictEqual([
      'TASK-22',
      'TASK-23',
      'TASK-24'
    ])
  })

  it('starts the next ticket of the queue once when a task ends, even when the end is told twice', async () => {
    fakeLinear.tickets = fiveWaitingTickets()
    const capacity = workersWithCapacity(2)
    const { poller } = openPoller(capacity.workers)

    await using polling = poller.start()
    await capacity.firstStart
    await vi.waitFor(() => {
      expect(capacity.started).toHaveLength(2)
    })
    const nextStart = capacity.nextStart()
    capacity.finish('TASK-20')
    capacity.finish('TASK-20')
    await nextStart
    await vi.waitFor(async () => {
      await expect(keysInQueue(poller)).resolves.toStrictEqual([
        'TASK-23',
        'TASK-24'
      ])
    })

    expect(capacity.started).toStrictEqual(['TASK-20', 'TASK-21', 'TASK-22'])
    expect(capacity.live()).toStrictEqual(['TASK-21', 'TASK-22'])
  })

  it('finds the same places in use and the same queue after a host restart', async () => {
    fakeLinear.tickets = fiveWaitingTickets()
    const capacity = workersWithCapacity(2)
    await openPoller(capacity.workers).poller.pollOnce()
    const restarted = openPoller(capacity.workers).poller

    await expect(restarted.pollOnce({ withStarted: true })).resolves.toBe(
      'full'
    )

    await expect(capacity.workers.freePlaces()).resolves.toBe(0)
    expect(capacity.started).toStrictEqual(['TASK-20', 'TASK-21'])
    await expect(keysInQueue(restarted)).resolves.toStrictEqual([
      'TASK-22',
      'TASK-23',
      'TASK-24'
    ])
  })

  it('puts a ticket back when a worker from the chat took the last place first', async () => {
    fakeLinear.tickets = [
      { identifier: 'TASK-25', labels: APP_TICKET, state: TODO }
    ]
    const capacity = workersWithCapacity(1)
    const { poller, lines } = openPoller({
      ...capacity.workers,
      startWorker: async (task) => {
        await capacity.workers.startWorker({ ...task, inputId: 'chat' })

        return capacity.workers.startWorker(task)
      }
    })

    await expect(poller.pollOnce()).resolves.toBe('full')

    expect(fakeLinear.moves).toStrictEqual([
      `TASK-25 → ${IN_PROGRESS.id}`,
      `TASK-25 → ${TODO.id}`
    ])
    expect(lines).toStrictEqual([])
    await expect(keysInQueue(poller)).resolves.toStrictEqual(['TASK-25'])
  })
})
