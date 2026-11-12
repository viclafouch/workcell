import { z } from 'zod'
import { createPacedFetch, type RateLimitCheck } from '@workcell/core'

export const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'

const REQUESTS_PER_MINUTE = 40

const OK_STATUS = 200

const RATE_LIMITED_STATUS = 429

const RATE_LIMIT_BUDGETS = ['requests', 'complexity', 'endpoint-requests']

const READY_TICKETS_QUERY = `query ReadyTickets($filter: IssueFilter!) {
  issues(filter: $filter, first: 50) {
    nodes {
      id
      identifier
      title
      url
      state { id type }
      labels(first: 20) { nodes { name } }
      team { states(filter: { type: { eq: "started" } }, first: 10) { nodes { id position } } }
    }
  }
}`

const MOVE_TICKET_MUTATION = `mutation MoveTicket($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success }
}`

const RESET_TICKET_QUERY = `query ResetTicket($id: String!) {
  issue(id: $id) {
    id
    identifier
    state { id type name }
    labels(first: 50) { nodes { id name } }
    attachments(first: 50) { nodes { id url } }
    team { states(filter: { type: { eq: "backlog" } }, first: 10) { nodes { id name position } } }
  }
}`

const REMOVE_LABEL_MUTATION = `mutation RemoveLabel($id: String!, $labelId: String!) {
  issueRemoveLabel(id: $id, labelId: $labelId) { success }
}`

const DELETE_ATTACHMENT_MUTATION = `mutation DeleteAttachment($id: String!) {
  attachmentDelete(id: $id) { success }
}`

const graphqlAnswerSchema = z.object({
  data: z.unknown().optional(),
  errors: z
    .array(
      z.object({
        message: z.string(),
        extensions: z.looseObject({ code: z.string().optional() }).optional()
      })
    )
    .optional()
})

const readyTicketsSchema = z.object({
  issues: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        identifier: z.string(),
        title: z.string(),
        url: z.string(),
        state: z.object({ id: z.string(), type: z.string() }),
        labels: z.object({ nodes: z.array(z.object({ name: z.string() })) }),
        team: z.object({
          states: z.object({
            nodes: z.array(z.object({ id: z.string(), position: z.number() }))
          })
        })
      })
    )
  })
})

const moveTicketSchema = z.object({
  issueUpdate: z.object({ success: z.boolean() })
})

const positionedStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.number()
})

const resetTicketSchema = z.object({
  issue: z.object({
    id: z.string(),
    identifier: z.string(),
    state: z.object({ id: z.string(), type: z.string(), name: z.string() }),
    labels: z.object({
      nodes: z.array(z.object({ id: z.string(), name: z.string() }))
    }),
    attachments: z.object({
      nodes: z.array(z.object({ id: z.string(), url: z.string() }))
    }),
    team: z.object({
      states: z.object({ nodes: z.array(positionedStateSchema) })
    })
  })
})

const removeLabelSchema = z.object({
  issueRemoveLabel: z.object({ success: z.boolean() })
})

const deleteAttachmentSchema = z.object({
  attachmentDelete: z.object({ success: z.boolean() })
})

type GraphqlRequestParams = {
  operationName: string
  query: string
  variables: Record<string, unknown>
}

type ReadyTicketsFilter = {
  readyLabel: string
  repositoryLabels: readonly string[]
  stateTypes: readonly string[]
}

export type LinearTicket = {
  id: string
  identifier: string
  title: string
  url: string
  stateId: string
  isStarted: boolean
  labels: string[]
  startedStateId: string | undefined
}

function readyTicketsFilter({
  readyLabel,
  repositoryLabels,
  stateTypes
}: ReadyTicketsFilter) {
  return {
    and: [
      { labels: { some: { name: { eq: readyLabel } } } },
      { labels: { some: { name: { in: repositoryLabels } } } },
      { state: { type: { in: stateTypes } } }
    ]
  }
}

function isLinearRateLimited({ response, text }: RateLimitCheck) {
  if (response.status === RATE_LIMITED_STATUS) {
    return true
  }

  const { errors = [] } = graphqlAnswerSchema.parse(JSON.parse(text))

  return errors.some(({ extensions }) => {
    return extensions?.code === 'RATELIMITED'
  })
}

function linearRateLimitResetAt(headers: Headers) {
  const resets = RATE_LIMIT_BUDGETS.filter((budget) => {
    return headers.get(`x-ratelimit-${budget}-remaining`) === '0'
  })
    .map((budget) => {
      return Number(headers.get(`x-ratelimit-${budget}-reset`))
    })
    .filter((reset) => {
      return Number.isFinite(reset) && reset > 0
    })

  return resets.length > 0 ? Math.max(...resets) : undefined
}

function firstState<State extends { position: number }>(states: State[]) {
  return states.toSorted((left, right) => {
    return left.position - right.position
  })[0]
}

export function createLinearApi(apiKey: string) {
  const { pacedFetch, [Symbol.dispose]: dispose } = createPacedFetch({
    apiName: 'Linear',
    subject: 'the Linear intake',
    requestsPerMinute: REQUESTS_PER_MINUTE,
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    isRateLimited: isLinearRateLimited,
    rateLimitResetAt: linearRateLimitResetAt
  })

  const request = async ({
    operationName,
    query,
    variables
  }: GraphqlRequestParams) => {
    const { status, text } = await pacedFetch(LINEAR_GRAPHQL_URL, {
      method: 'POST',
      body: JSON.stringify({ operationName, query, variables })
    })
    const { data, errors = [] } = graphqlAnswerSchema.parse(JSON.parse(text))

    if (status !== OK_STATUS || errors.length > 0) {
      const reasons = errors.map(({ message }) => {
        return message
      })

      throw new Error(
        `Linear refused ${operationName} with ${status}: ${reasons.join(' ')}`
      )
    }

    return data
  }

  const readyTickets = async (
    filter: ReadyTicketsFilter
  ): Promise<LinearTicket[]> => {
    const data = await request({
      operationName: 'ReadyTickets',
      query: READY_TICKETS_QUERY,
      variables: { filter: readyTicketsFilter(filter) }
    })

    return readyTicketsSchema
      .parse(data)
      .issues.nodes.map(
        ({ id, identifier, title, url, state, labels, team }) => {
          return {
            id,
            identifier,
            title,
            url,
            stateId: state.id,
            isStarted: state.type === 'started',
            labels: labels.nodes.map(({ name }) => {
              return name
            }),
            startedStateId: firstState(team.states.nodes)?.id
          }
        }
      )
  }

  const moveTicket = async (id: string, stateId: string) => {
    const data = await request({
      operationName: 'MoveTicket',
      query: MOVE_TICKET_MUTATION,
      variables: { id, stateId }
    })

    if (!moveTicketSchema.parse(data).issueUpdate.success) {
      throw new Error(`Linear did not move ${id} to the state ${stateId}.`)
    }
  }

  const readResetTicket = async (identifier: string) => {
    const data = await request({
      operationName: 'ResetTicket',
      query: RESET_TICKET_QUERY,
      variables: { id: identifier }
    })
    const { issue } = resetTicketSchema.parse(data)

    return {
      id: issue.id,
      identifier: issue.identifier,
      state: issue.state,
      labels: issue.labels.nodes,
      attachments: issue.attachments.nodes,
      backlogState: firstState(issue.team.states.nodes)
    }
  }

  const removeLabel = async (id: string, labelId: string) => {
    const data = await request({
      operationName: 'RemoveLabel',
      query: REMOVE_LABEL_MUTATION,
      variables: { id, labelId }
    })

    if (!removeLabelSchema.parse(data).issueRemoveLabel.success) {
      throw new Error(`Linear did not remove the label ${labelId} of ${id}.`)
    }
  }

  const deleteAttachment = async (id: string) => {
    const data = await request({
      operationName: 'DeleteAttachment',
      query: DELETE_ATTACHMENT_MUTATION,
      variables: { id }
    })

    if (!deleteAttachmentSchema.parse(data).attachmentDelete.success) {
      throw new Error(`Linear did not delete the attachment ${id}.`)
    }
  }

  return {
    readyTickets,
    moveTicket,
    readResetTicket,
    removeLabel,
    deleteAttachment,
    [Symbol.dispose]: dispose
  }
}

export type LinearApi = ReturnType<typeof createLinearApi>
