import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  APP_TICKET,
  fakeLinear,
  IN_PROGRESS,
  network,
  openPoller,
  recordStarts,
  resetFakeLinear
} from './fake-linear.ts'

describe('the ticket a worker carries', () => {
  beforeAll(() => {
    network.listen({ onUnhandledFrame: 'error' })
  })

  beforeEach(resetFakeLinear)

  afterAll(() => {
    network.close()
  })

  it('reads a ticket by its key, with its description', async () => {
    fakeLinear.tickets = [
      {
        identifier: 'TASK-30',
        labels: APP_TICKET,
        state: IN_PROGRESS,
        priority: 2,
        assignee: { name: 'Ada Lovelace', avatarUrl: 'https://avatars/ada' },
        description: 'The login button does nothing.\n\n* Make it log in.'
      }
    ]
    const { poller } = openPoller(recordStarts([]))

    await expect(poller.tracker.ticket('TASK-30')).resolves.toStrictEqual({
      key: 'TASK-30',
      title: 'Fix the login',
      url: 'https://linear.app/acme/issue/TASK-30',
      state: { name: 'In Progress', category: 'open', color: '#f2c94c' },
      labels: [
        { name: 'agent-ready', color: '#5e6ad2' },
        { name: 'repo:app', color: '#5e6ad2' }
      ],
      assignees: [{ name: 'Ada Lovelace', avatarUrl: 'https://avatars/ada' }],
      priority: 'High',
      description: 'The login button does nothing.\n\n* Make it log in.'
    })
  })

  it('reads a ticket with no description as an empty one', async () => {
    fakeLinear.tickets = [
      { identifier: 'TASK-31', labels: APP_TICKET, state: IN_PROGRESS }
    ]
    const { poller } = openPoller(recordStarts([]))

    const ticket = await poller.tracker.ticket('TASK-31')

    expect(ticket?.description).toBe('')
  })

  it('answers no ticket for a key Linear does not know', async () => {
    const { poller } = openPoller(recordStarts([]))

    await expect(poller.tracker.ticket('TASK-404')).resolves.toBeNull()
  })

  it('answers no ticket for a subject that is no ticket key, without asking Linear', async () => {
    const { poller } = openPoller(recordStarts([]))

    await expect(
      poller.tracker.ticket('Fix the login button')
    ).resolves.toBeNull()
    expect(fakeLinear.requests).toBe(0)
  })
})
