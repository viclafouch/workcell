import {
  LinearDocument,
  LinearError,
  LinearGraphQLClient,
  InvalidInputLinearError,
  LinearSdk,
  parseLinearError,
  RatelimitedLinearError,
  type Attachment,
  type Issue,
  type IssueLabel,
  type PageInfo,
  type User,
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

const NO_PRIORITY = 0

const TICKETS_PER_PAGE = 50

const LABELS_PER_TICKET = 50

type LabelledTicketsFilter = {
  readyLabel: string
  stateTypes: readonly string[]
}

type TicketNode = Pick<
  Issue,
  'id' | 'identifier' | 'title' | 'url' | 'priority' | 'priorityLabel'
> & {
  state: Pick<WorkflowState, 'id' | 'name' | 'type' | 'color'>
  labels: { nodes: Pick<IssueLabel, 'name' | 'color'>[] }
  assignee: Pick<User, 'name' | 'avatarUrl'> | null
}

type LabelledTicketNode = TicketNode & {
  team: { states: { nodes: Pick<WorkflowState, 'id' | 'position'>[] } }
}

type TicketDetailsNode = TicketNode & Pick<Issue, 'description'>

type LabelledTicketsPage = {
  issues: {
    nodes: LabelledTicketNode[]
    pageInfo: Pick<PageInfo, 'hasNextPage' | 'endCursor'>
  }
}

type LabelledTicketsVariables = LinearDocument.IssuesQueryVariables & {
  startedState: LinearDocument.WorkflowStateFilter
}

const PRIORITY_ORDER: LinearDocument.IssueSortInput[] = [
  { priority: { order: LinearDocument.PaginationSortOrder.Descending } }
]

const STARTED_STATE: LinearDocument.WorkflowStateFilter = {
  type: { eq: STARTED_STATE_TYPE }
}

type LinearTicketFields = Pick<Issue, 'id' | 'identifier' | 'title' | 'url'> & {
  state: Pick<WorkflowState, 'id' | 'name' | 'type' | 'color'>
  priority: string | undefined
  labels: Pick<IssueLabel, 'name' | 'color'>[]
  assignee: { name: string; avatarUrl: string | undefined } | undefined
}

export type LinearTicket = LinearTicketFields & {
  startedStateId: string | undefined
}

export type LinearTicketDetails = LinearTicketFields & {
  description: string
}

export type ResetTicket = Pick<Issue, 'id' | 'identifier'> & {
  state: Pick<WorkflowState, 'id' | 'type' | 'name'>
  labels: Pick<IssueLabel, 'id' | 'name'>[]
  attachments: Pick<Attachment, 'id' | 'url'>[]
  backlogState: Pick<WorkflowState, 'id' | 'name' | 'position'> | undefined
}

const TICKET_FIELDS = `id
      identifier
      title
      url
      priority
      priorityLabel
      state { id name type color }
      labels(first: ${LABELS_PER_TICKET}) { nodes { name color } }
      assignee { name avatarUrl }`

const LABELLED_TICKETS_QUERY = `query labelledTickets($filter: IssueFilter, $sort: [IssueSortInput!], $first: Int, $after: String, $startedState: WorkflowStateFilter) {
  issues(filter: $filter, sort: $sort, first: $first, after: $after) {
    nodes {
      ${TICKET_FIELDS}
      team { states(filter: $startedState) { nodes { id position } } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`

const TICKET_QUERY = `query ticket($key: String!) {
  issue(id: $key) {
    ${TICKET_FIELDS}
    description
  }
}`

const TICKET_KEY = /^[A-Z][A-Z0-9]*-\d+$/u

function labelledTicketsFilter({
  readyLabel,
  stateTypes
}: LabelledTicketsFilter): LinearDocument.IssueFilter {
  return {
    and: [
      { labels: { some: { name: { eq: readyLabel } } } },
      { state: { type: { in: [...stateTypes] } } }
    ]
  }
}

function ticketFieldsOf({
  id,
  identifier,
  title,
  url,
  priority,
  priorityLabel,
  state,
  labels,
  assignee
}: TicketNode): LinearTicketFields {
  return {
    id,
    identifier,
    title,
    url,
    state,
    priority: priority === NO_PRIORITY ? undefined : priorityLabel,
    labels: labels.nodes,
    assignee:
      assignee === null
        ? undefined
        : { name: assignee.name, avatarUrl: assignee.avatarUrl ?? undefined }
  }
}

function linearTicketOf(node: LabelledTicketNode): LinearTicket {
  return {
    ...ticketFieldsOf(node),
    startedStateId: firstState(node.team.states.nodes)?.id
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

  const labelledTickets = async (
    filter: LabelledTicketsFilter
  ): Promise<LinearTicket[]> => {
    const readPage = async (after?: string): Promise<LabelledTicketNode[]> => {
      const variables: LabelledTicketsVariables = {
        filter: labelledTicketsFilter(filter),
        sort: PRIORITY_ORDER,
        first: TICKETS_PER_PAGE,
        after,
        startedState: STARTED_STATE
      }
      const { issues } = await request<LabelledTicketsPage>(
        LABELLED_TICKETS_QUERY,
        variables
      )
      const { hasNextPage, endCursor } = issues.pageInfo

      return hasNextPage && endCursor !== null && endCursor !== undefined
        ? [...issues.nodes, ...(await readPage(endCursor))]
        : issues.nodes
    }

    const nodes = await readPage()

    return nodes.map(linearTicketOf)
  }

  const ticket = async (
    key: string
  ): Promise<LinearTicketDetails | undefined> => {
    if (!TICKET_KEY.test(key)) {
      return undefined
    }

    try {
      const { issue } = await request<{ issue: TicketDetailsNode }>(
        TICKET_QUERY,
        { key }
      )

      return { ...ticketFieldsOf(issue), description: issue.description ?? '' }
    } catch (error) {
      if (error instanceof InvalidInputLinearError) {
        return undefined
      }

      throw error
    }
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
    labelledTickets,
    ticket,
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
