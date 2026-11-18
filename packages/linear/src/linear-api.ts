import {
  LinearError,
  LinearGraphQLClient,
  LinearSdk,
  parseLinearError,
  RatelimitedLinearError,
  type Attachment,
  type Issue,
  type IssueLabel,
  type WorkflowState
} from '@linear/sdk'
import { AsyncRetryer, RateLimiter } from '@tanstack/pacer'

export const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'

const REQUESTS_PER_MINUTE = 40

const WINDOW_MS = 60_000

const REQUEST_TIMEOUT_MS = 30_000

const MAX_ATTEMPTS = 4

const MAX_RETRY_WAIT_MS = 30_000

const UNNAMED_RATE_LIMIT_WAIT_MS = 60_000

const MS_PER_SECOND = 1000

const FIRST_SERVER_ERROR_STATUS = 500

const STARTED_STATE_TYPE = 'started'

const BACKLOG_STATE_TYPE = 'backlog'

type ReadyTicketsFilter = {
  readyLabel: string
  repositoryLabels: readonly string[]
  stateTypes: readonly string[]
}

export type LinearTicket = Pick<
  Issue,
  'id' | 'identifier' | 'title' | 'url'
> & {
  stateId: string
  isStarted: boolean
  labels: string[]
  startedStateId: string | undefined
}

export type ResetTicket = Pick<Issue, 'id' | 'identifier'> & {
  state: Pick<WorkflowState, 'id' | 'type' | 'name'>
  labels: Pick<IssueLabel, 'id' | 'name'>[]
  attachments: Pick<Attachment, 'id' | 'url'>[]
  backlogState: Pick<WorkflowState, 'id' | 'name' | 'position'> | undefined
}

function readyTicketsFilter({
  readyLabel,
  repositoryLabels,
  stateTypes
}: ReadyTicketsFilter) {
  return {
    and: [
      { labels: { some: { name: { eq: readyLabel } } } },
      { labels: { some: { name: { in: [...repositoryLabels] } } } },
      { state: { type: { in: [...stateTypes] } } }
    ]
  }
}

function matchIsTransient(error: Error | undefined) {
  return (
    error instanceof LinearError &&
    (error.status === undefined || error.status >= FIRST_SERVER_ERROR_STATUS)
  )
}

function rateLimitWaitMs({
  retryAfter,
  requestsRemaining,
  requestsResetAt,
  complexityRemaining,
  complexityResetAt
}: RatelimitedLinearError) {
  if (retryAfter !== undefined) {
    return retryAfter * MS_PER_SECOND
  }

  const resets = [
    requestsRemaining === 0 ? requestsResetAt : undefined,
    complexityRemaining === 0 ? complexityResetAt : undefined
  ].filter((reset) => {
    return reset !== undefined
  })

  return resets.length === 0
    ? UNNAMED_RATE_LIMIT_WAIT_MS
    : Math.max(...resets) - Temporal.Now.instant().epochMilliseconds
}

function firstState<State extends Pick<WorkflowState, 'position'>>(
  states: readonly State[]
) {
  return states.toSorted((left, right) => {
    return left.position - right.position
  })[0]
}

function uniqueOf(values: readonly (string | undefined)[]) {
  return [
    ...new Set(
      values.filter((value) => {
        return value !== undefined
      })
    )
  ]
}

export function createLinearApi(apiKey: string) {
  const requests = new RateLimiter(() => {}, {
    limit: REQUESTS_PER_MINUTE,
    window: WINDOW_MS,
    windowType: 'sliding'
  })
  const retryers = new Set<{ abort: () => void }>()
  let rateLimitedUntil = Temporal.Instant.fromEpochMilliseconds(0)

  const graphql = new LinearGraphQLClient(LINEAR_GRAPHQL_URL, {
    headers: { Authorization: apiKey },
    fetch: (url, init) => {
      return fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    }
  })

  const rateLimitError = () => {
    return new Error(
      `Linear rate limits the Linear intake until ${rateLimitedUntil.toString({ smallestUnit: 'millisecond' })}. The call did not run.`
    )
  }

  const request = async <Data>(
    document: string,
    variables?: Record<string, unknown>
  ): Promise<Data> => {
    if (
      Temporal.Instant.compare(Temporal.Now.instant(), rateLimitedUntil) < 0
    ) {
      throw rateLimitError()
    }

    if (!requests.maybeExecute()) {
      throw new Error(
        `The budget of the Linear intake is ${REQUESTS_PER_MINUTE} Linear requests a minute: the next request can run in ${Math.ceil(requests.getMsUntilNextWindow() / MS_PER_SECOND)} s. The call did not run.`
      )
    }

    const retryer = new AsyncRetryer(
      async () => {
        try {
          return await graphql.request<Data, Record<string, unknown>>(
            document,
            variables
          )
        } catch (error) {
          throw parseLinearError(Error.isError(error) ? error : undefined)
        }
      },
      {
        maxAttempts: ({ store }) => {
          const { lastError } = store.state

          return lastError === undefined || matchIsTransient(lastError)
            ? MAX_ATTEMPTS
            : 1
        },
        maxWait: MAX_RETRY_WAIT_MS,
        jitter: 0.2,
        throwOnError: true
      }
    )
    retryers.add(retryer)

    try {
      const answer = await retryer.execute()

      if (answer === undefined) {
        throw new Error('The Linear intake stopped before Linear answered.')
      }

      return answer
    } catch (error) {
      if (error instanceof RatelimitedLinearError) {
        rateLimitedUntil = Temporal.Now.instant().add({
          milliseconds: Math.max(Math.ceil(rateLimitWaitMs(error)), 0)
        })
        throw rateLimitError()
      }

      throw error
    } finally {
      retryers.delete(retryer)
    }
  }

  const linear = new LinearSdk(request)

  const readyTickets = async (
    filter: ReadyTicketsFilter
  ): Promise<LinearTicket[]> => {
    const issues = await linear.paginate(
      (variables) => {
        return linear.issues(variables)
      },
      { filter: readyTicketsFilter(filter) }
    )

    if (issues.length === 0) {
      return []
    }

    const [states, labels] = await Promise.all([
      linear.paginate(
        (variables) => {
          return linear.workflowStates(variables)
        },
        {
          filter: {
            team: {
              id: {
                in: uniqueOf(
                  issues.map(({ teamId }) => {
                    return teamId
                  })
                )
              }
            }
          }
        }
      ),
      linear.paginate(
        (variables) => {
          return linear.issueLabels(variables)
        },
        {
          filter: {
            id: {
              in: uniqueOf(
                issues.flatMap(({ labelIds }) => {
                  return labelIds
                })
              )
            }
          }
        }
      )
    ])
    const labelNames = new Map(
      labels.map(({ id, name }) => {
        return [id, name]
      })
    )

    return issues.flatMap(
      ({ id, identifier, title, url, stateId, teamId, labelIds }) => {
        if (stateId === undefined) {
          return []
        }

        const teamStates = states.filter((state) => {
          return state.teamId === teamId
        })

        return {
          id,
          identifier,
          title,
          url,
          stateId,
          isStarted: teamStates.some((state) => {
            return state.id === stateId && state.type === STARTED_STATE_TYPE
          }),
          labels: uniqueOf(
            labelIds.map((labelId) => {
              return labelNames.get(labelId)
            })
          ),
          startedStateId: firstState(
            teamStates.filter(({ type }) => {
              return type === STARTED_STATE_TYPE
            })
          )?.id
        }
      }
    )
  }

  const moveTicket = async (id: string, stateId: string) => {
    const { success } = await linear.updateIssue(id, { stateId })

    if (!success) {
      throw new Error(`Linear did not move ${id} to the state ${stateId}.`)
    }
  }

  const readResetTicket = async (identifier: string): Promise<ResetTicket> => {
    const issue = await linear.issue(identifier)
    const [state, labels, attachments, backlogStates] = await Promise.all([
      issue.state,
      issue.labels(),
      issue.attachments(),
      linear.workflowStates({
        filter: {
          team: { id: { eq: issue.teamId } },
          type: { eq: BACKLOG_STATE_TYPE }
        }
      })
    ])

    if (state === undefined) {
      throw new Error(`Linear gave no state to ${identifier}.`)
    }

    return {
      id: issue.id,
      identifier: issue.identifier,
      state,
      labels: labels.nodes,
      attachments: attachments.nodes,
      backlogState: firstState(backlogStates.nodes)
    }
  }

  const removeLabel = async (id: string, labelId: string) => {
    const { success } = await linear.issueRemoveLabel(id, labelId)

    if (!success) {
      throw new Error(`Linear did not remove the label ${labelId} of ${id}.`)
    }
  }

  const deleteAttachment = async (id: string) => {
    const { success } = await linear.deleteAttachment(id)

    if (!success) {
      throw new Error(`Linear did not delete the attachment ${id}.`)
    }
  }

  const teamKeys = async () => {
    const teams = await linear.paginate((variables) => {
      return linear.teams(variables)
    }, {})

    return teams.map(({ key }) => {
      return key
    })
  }

  return {
    readyTickets,
    teamKeys,
    moveTicket,
    readResetTicket,
    removeLabel,
    deleteAttachment,
    [Symbol.dispose]: () => {
      for (const retryer of retryers) {
        retryer.abort()
      }

      retryers.clear()
      requests.reset()
    }
  }
}

export type LinearApi = ReturnType<typeof createLinearApi>
