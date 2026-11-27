import { setTimeout } from 'node:timers/promises'
import type { HarnessUser } from '@tanstack/ai-harness'
import {
  startLoop,
  type QueuedTicket,
  type TicketQueue,
  type WorkerTask
} from '@workcell/core'
import type { LinearApi, LinearTicket } from './linear-api.ts'
import { ticketTask } from './prompts/linear.ts'

const CLAIMABLE_STATE_TYPES = ['backlog', 'unstarted']

const STARTED_STATE_TYPE = 'started'

const CLOSED_STATE_TYPES = new Set(['completed', 'canceled', 'duplicate'])

const TRACKER_NAME = 'Linear'

type LogLine = (details: Record<string, unknown>, message: string) => void

type TicketPollerParams = {
  linear: LinearApi
  startWorker: (
    workerTask: WorkerTask
  ) => Promise<{ name: string; isNew: boolean }>
  starter: HarnessUser
  readyLabel: string
  repositoryLabels: Readonly<Record<string, string>>
  pollIntervalMs: number
  logger: { info: LogLine; error: LogLine }
}

function queuedTicketOf(
  { identifier, title, url, state, labels, assignee, priority }: LinearTicket,
  blocker: string | null
): QueuedTicket {
  return {
    key: identifier,
    title,
    url,
    state: {
      name: state.name,
      category: CLOSED_STATE_TYPES.has(state.type) ? 'closed' : 'open'
    },
    labels: labels.map(({ name, color }) => {
      return { name, color }
    }),
    assignees: assignee === undefined ? [] : [assignee],
    priority,
    blocker: blocker ?? undefined
  }
}

export function createTicketPoller({
  linear,
  startWorker,
  starter,
  readyLabel,
  repositoryLabels,
  pollIntervalMs,
  logger
}: TicketPollerParams) {
  const failedStarts = new Map<string, string>()

  const repositoryOf = ({ labels }: LinearTicket) => {
    const label = labels.find(({ name }) => {
      return Object.hasOwn(repositoryLabels, name)
    })

    return label === undefined ? undefined : repositoryLabels[label.name]
  }

  const blockerOf = (ticket: LinearTicket): string | null => {
    const failure = failedStarts.get(ticket.id)

    if (failure !== undefined) {
      return `Its worker failed to start, and the host tries again at its next start: ${failure}`
    }

    if (repositoryOf(ticket) === undefined) {
      return `It needs a repository label: ${Object.keys(repositoryLabels).join(', ')}.`
    }

    if (ticket.startedStateId === undefined) {
      return 'Its team has no started state to move it to.'
    }

    return null
  }

  const startTicket = async (ticket: LinearTicket) => {
    const { id, identifier, state, startedStateId } = ticket
    const repository = repositoryOf(ticket)
    const isStarted = state.type === STARTED_STATE_TYPE

    if (repository === undefined || startedStateId === undefined) {
      throw new Error(
        `${identifier} needs a repository label, and its team a started state.`
      )
    }

    if (!isStarted) {
      await linear.moveTicket(id, startedStateId)
    }

    try {
      const { name, isNew } = await startWorker({
        starter,
        repository,
        task: ticketTask({ ...ticket, repository }),
        subject: identifier,
        inputId: id
      })
      logger.info(
        { ticket: identifier, worker: name, isNew },
        'ticket worker ready'
      )
    } catch (error) {
      if (!isStarted) {
        await linear.moveTicket(id, state.id)
      }

      throw error
    }
  }

  const readQueue = async () => {
    const tickets = await linear.labelledTickets({
      readyLabel,
      stateTypes: CLAIMABLE_STATE_TYPES
    })

    return tickets.map((ticket) => {
      return queuedTicketOf(ticket, blockerOf(ticket))
    })
  }

  const pollOnce = async ({ withStarted = false } = {}) => {
    const tickets = await linear.labelledTickets({
      readyLabel,
      stateTypes: withStarted
        ? [...CLAIMABLE_STATE_TYPES, STARTED_STATE_TYPE]
        : CLAIMABLE_STATE_TYPES
    })
    const startableTickets = tickets.filter((ticket) => {
      return blockerOf(ticket) === null
    })

    for (const ticket of startableTickets) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- the tickets start one at a time, in the order of the queue
        await startTicket(ticket)
      } catch (error) {
        failedStarts.set(
          ticket.id,
          Error.isError(error) ? error.message : String(error)
        )
        logger.error(
          { ticket: ticket.identifier, error },
          'ticket not taken: it keeps its state, and the host tries it again at its next start'
        )
      }
    }
  }

  const run = async (signal: AbortSignal) => {
    let isFirstPoll = true

    while (!signal.aborted) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- the poll reads once per interval
        await pollOnce({ withStarted: isFirstPoll })
        isFirstPoll = false
      } catch (error) {
        logger.error({ error }, 'ticket poll failed')
      }

      // oxlint-disable-next-line no-await-in-loop -- the poll waits between two reads
      await setTimeout(pollIntervalMs, null, { signal }).catch(() => {
        return null
      })
    }
  }

  const queue: TicketQueue = { tracker: TRACKER_NAME, read: readQueue }

  return {
    pollOnce,
    queue,
    start: () => {
      return startLoop(run)
    }
  }
}
