import { z } from 'zod'
import { createPacedFetch, type RateLimitCheck } from '@workcell/core'

export const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql'

export const GITHUB_REST_URL = 'https://api.github.com'

const REQUESTS_PER_MINUTE = 20

export const GITHUB_JSON_MEDIA_TYPE = 'application/vnd.github+json'

const OPERATION_NAME = 'WatchedPullRequests'

const OK_STATUS = 200

const FORBIDDEN_STATUS = 403

const TOO_MANY_REQUESTS_STATUS = 429

const MS_PER_SECOND = 1000

const authorSchema = z
  .object({ __typename: z.string(), login: z.string() })
  .nullable()

const statusContextSchema = z.object({
  id: z.string(),
  context: z.string(),
  state: z.string(),
  description: z.string().nullable(),
  targetUrl: z.string().nullable(),
  isRequired: z.boolean()
})

const commentSchema = z.object({
  id: z.string(),
  url: z.string(),
  author: authorSchema
})

const timelineItemSchema = z.discriminatedUnion('__typename', [
  z.object({ __typename: z.literal('AddedToMergeQueueEvent'), id: z.string() }),
  z.object({
    __typename: z.literal('RemovedFromMergeQueueEvent'),
    id: z.string(),
    reason: z.string().nullable()
  })
])

const watchedPullRequestSchema = z.object({
  number: z.number(),
  url: z.string(),
  merged: z.boolean(),
  mergeable: z.string(),
  headRefOid: z.string(),
  mergeCommit: z.object({ oid: z.string() }).nullable(),
  statusCheckRollup: z.object({ state: z.string() }).nullable(),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          status: z
            .object({ contexts: z.array(statusContextSchema) })
            .nullable()
        })
      })
    )
  }),
  reviewThreads: z.object({
    nodes: z.array(
      z.object({
        isResolved: z.boolean(),
        comments: z.object({ nodes: z.array(commentSchema) })
      })
    )
  }),
  comments: z.object({ nodes: z.array(commentSchema) }),
  reviews: z.object({
    nodes: z.array(
      commentSchema.extend({ state: z.string(), body: z.string() })
    )
  }),
  timelineItems: z.object({ nodes: z.array(timelineItemSchema) })
})

const foundPullRequestSchema = z.object({
  pullRequests: z.object({
    nodes: z.array(z.object({ number: z.number(), url: z.string() }))
  })
})

const readPullRequestSchema = z.object({
  pullRequest: watchedPullRequestSchema.nullable()
})

const viewerSchema = z.object({ viewer: z.object({ login: z.string() }) })

const graphqlResultSchema = z.object({
  data: z.unknown(),
  errors: z
    .array(z.object({ message: z.string(), type: z.string().optional() }))
    .optional()
})

const graphqlErrorsSchema = z.looseObject({
  errors: z.array(z.looseObject({ type: z.string().optional() })).optional()
})

export type WatchedPullRequest = z.infer<typeof watchedPullRequestSchema>

export type StatusContext = z.infer<typeof statusContextSchema>

export type Author = z.infer<typeof authorSchema>

export type PullRequestHeadRef = { repository: string; branch: string }

type GraphqlAnswer = { status: number; text: string; subject: string }

export type PullRequestHead = {
  repository: string
  branch: string
  number: number | undefined
}

export type PullRequestRead =
  | { found: false }
  | {
      found: true
      number: number
      url: string
      pullRequest: WatchedPullRequest | undefined
    }

const watchedPullRequestFields = (numberVariable: string) => {
  return `number url merged mergeable headRefOid
      mergeCommit { oid }
      statusCheckRollup { state }
      commits(last: 1) {
        nodes { commit { status { contexts { id context state description targetUrl isRequired(pullRequestNumber: ${numberVariable}) } } } }
      }
      reviewThreads(last: 50) {
        nodes { isResolved comments(last: 20) { nodes { id url author { __typename login } } } }
      }
      comments(last: 50) { nodes { id url author { __typename login } } }
      reviews(last: 30) { nodes { id url state body author { __typename login } } }
      timelineItems(last: 20, itemTypes: [ADDED_TO_MERGE_QUEUE_EVENT, REMOVED_FROM_MERGE_QUEUE_EVENT]) {
        nodes {
          __typename
          ... on AddedToMergeQueueEvent { id }
          ... on RemovedFromMergeQueueEvent { id reason }
        }
      }`
}

export function splitRepository(repository: string) {
  const [owner, name] = repository.split('/')

  if (owner === undefined || name === undefined) {
    throw new Error(`The repository ${repository} is not owner/name.`)
  }

  return { owner, name }
}

function watchQuery(heads: readonly PullRequestHead[]) {
  const declarations: string[] = []
  const selections: string[] = []
  const variables: Record<string, unknown> = {}

  for (const [index, { repository, branch, number }] of heads.entries()) {
    const { owner, name } = splitRepository(repository)
    variables[`owner${index}`] = owner
    variables[`name${index}`] = name
    declarations.push(`$owner${index}: String!`, `$name${index}: String!`)

    if (number === undefined) {
      variables[`branch${index}`] = branch
      declarations.push(`$branch${index}: String!`)
      selections.push(`pr${index}: repository(owner: $owner${index}, name: $name${index}) {
    pullRequests(headRefName: $branch${index}, first: 1, states: [OPEN, MERGED], orderBy: { field: CREATED_AT, direction: DESC }) { nodes { number url } }
  }`)
    } else {
      variables[`number${index}`] = number
      declarations.push(`$number${index}: Int!`)
      selections.push(`pr${index}: repository(owner: $owner${index}, name: $name${index}) {
    pullRequest(number: $number${index}) { ${watchedPullRequestFields(`$number${index}`)} }
  }`)
    }
  }

  return {
    query: `query ${OPERATION_NAME}(${declarations.join(', ')}) {
  viewer { login }
  ${selections.join('\n  ')}
}`,
    variables
  }
}

function readOf(head: PullRequestHead, selection: unknown): PullRequestRead {
  if (head.number === undefined) {
    const [found] = foundPullRequestSchema.parse(selection).pullRequests.nodes

    return found === undefined
      ? { found: false }
      : { found: true, ...found, pullRequest: undefined }
  }

  const { pullRequest } = readPullRequestSchema.parse(selection)

  return pullRequest === null
    ? { found: false }
    : {
        found: true,
        number: head.number,
        url: pullRequest.url,
        pullRequest
      }
}

const watchDataSchema = z.record(z.string(), z.unknown())

function isGraphqlRateLimited(text: string) {
  const { errors = [] } = graphqlErrorsSchema.parse(JSON.parse(text))

  return errors.some(({ type }) => {
    return type === 'RATE_LIMITED'
  })
}

export function graphqlDataOf<Schema extends z.ZodType>(
  { status, text, subject }: GraphqlAnswer,
  dataSchema: Schema
): z.infer<Schema> {
  const { data, errors = [] } = graphqlResultSchema.parse(JSON.parse(text))

  if (status !== OK_STATUS || errors.length > 0) {
    const reasons = errors.map(({ message }) => {
      return message
    })

    throw new Error(
      `GitHub refused ${subject} with ${status}: ${reasons.join(' ')}`
    )
  }

  return dataSchema.parse(data)
}

function isRateLimitedResponse(response: Response) {
  return (
    response.status === TOO_MANY_REQUESTS_STATUS ||
    (response.status === FORBIDDEN_STATUS &&
      (response.headers.get('x-ratelimit-remaining') === '0' ||
        response.headers.has('retry-after')))
  )
}

function isGithubRateLimited({ url, response, text }: RateLimitCheck) {
  return (
    isRateLimitedResponse(response) ||
    (url === GITHUB_GRAPHQL_URL && isGraphqlRateLimited(text))
  )
}

function githubRateLimitResetAt(headers: Headers) {
  const resetSeconds = Number(headers.get('x-ratelimit-reset') ?? Number.NaN)

  return Number.isFinite(resetSeconds)
    ? resetSeconds * MS_PER_SECOND
    : undefined
}

export function githubPacing(token: string) {
  return {
    apiName: 'GitHub',
    headers: { authorization: `Bearer ${token}` },
    isRateLimited: isGithubRateLimited,
    rateLimitResetAt: githubRateLimitResetAt
  }
}

export function createGithubApi(token: string) {
  const { pacedFetch, [Symbol.dispose]: dispose } = createPacedFetch({
    ...githubPacing(token),
    subject: 'the pull request watch',
    requestsPerMinute: REQUESTS_PER_MINUTE
  })

  const readPullRequests = async (heads: readonly PullRequestHead[]) => {
    const answer = await pacedFetch(GITHUB_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operationName: OPERATION_NAME,
        ...watchQuery(heads)
      })
    })
    const data = graphqlDataOf(
      { ...answer, subject: OPERATION_NAME },
      watchDataSchema
    )
    const { viewer } = viewerSchema.parse(data)

    return {
      viewerLogin: viewer.login,
      reads: heads.map((head, index) => {
        return readOf(head, data[`pr${index}`])
      })
    }
  }

  return {
    readPullRequests,
    [Symbol.dispose]: dispose
  }
}

export type GithubApi = ReturnType<typeof createGithubApi>
