import { setTimeout } from 'node:timers/promises'
import type { HarnessUser } from '@tanstack/ai-harness'
import { startLoop, type WorkerTask } from '@workcell/core'
import type { LinearApi, LinearTicket } from './linear-api.ts'
import { ticketTask } from './prompts/linear.ts'

const CLAIMABLE_STATE_TYPES = ['backlog', 'unstarted']

const STARTED_STATE_TYPE = 'started'

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

export function createTicketPoller({
  linear,
  startWorker,
  starter,
  readyLabel,
  repositoryLabels,
  pollIntervalMs,
  logger
}: TicketPollerParams) {
  const failedTicketIds = new Set<string>()

  const repositoryOf = ({ labels }: LinearTicket) => {
    const label = labels.find((name) => {
      return Object.hasOwn(repositoryLabels, name)
    })

    return label === undefined ? undefined : repositoryLabels[label]
  }

  const startTicket = async (ticket: LinearTicket) => {
    const { id, identifier, stateId, isStarted, startedStateId } = ticket
    const repository = repositoryOf(ticket)

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
        await linear.moveTicket(id, stateId)
      }

      throw error
    }
  }

  const pollOnce = async ({ withStarted = false } = {}) => {
    const tickets = await linear.readyTickets({
      readyLabel,
      repositoryLabels: Object.keys(repositoryLabels),
      stateTypes: withStarted
        ? [...CLAIMABLE_STATE_TYPES, STARTED_STATE_TYPE]
        : CLAIMABLE_STATE_TYPES
    })
    const newTickets = tickets.filter(({ id }) => {
      return !failedTicketIds.has(id)
    })

    for (const ticket of newTickets) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- the tickets start one at a time, in the order Linear lists them
        await startTicket(ticket)
      } catch (error) {
        failedTicketIds.add(ticket.id)
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

  return {
    pollOnce,
    start: () => {
      return startLoop(run)
    }
  }
}
