import { z } from 'zod'
import { createPacedFetch } from '@workcell/core'
import { REVIEW_THREADS_TEXT } from '#/prompts/github.ts'
import {
  GITHUB_GRAPHQL_URL,
  GITHUB_JSON_MEDIA_TYPE,
  GITHUB_REST_URL,
  githubPacing,
  graphqlDataOf,
  splitRepository,
  type PullRequestHeadRef
} from './github-api.ts'

const REQUESTS_PER_MINUTE = 20

const CREATED_STATUS = 201

const REVIEW_THREAD_TARGET_QUERY = `query ReviewThreadTarget($owner: String!, $name: String!, $branch: String!, $threadId: ID!) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $branch, first: 1, states: [OPEN], orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes { id number }
    }
  }
  node(id: $threadId) {
    ... on PullRequestReviewThread {
      isResolved
      pullRequest { id }
      comments(first: 1) { nodes { fullDatabaseId } }
    }
  }
}`

const RESOLVE_MUTATION = `mutation ResolveReviewThread($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } }
}`

const reviewThreadNodeSchema = z.object({
  isResolved: z.boolean(),
  pullRequest: z.object({ id: z.string() }),
  comments: z.object({
    nodes: z.array(z.object({ fullDatabaseId: z.string() }))
  })
})

const reviewThreadTargetSchema = z.object({
  repository: z
    .object({
      pullRequests: z.object({
        nodes: z.array(z.object({ id: z.string(), number: z.number() }))
      })
    })
    .nullable(),
  node: reviewThreadNodeSchema.nullable().or(
    z.object({}).transform(() => {
      return null
    })
  )
})

const resolvedThreadSchema = z.object({
  resolveReviewThread: z.object({
    thread: z.object({ isResolved: z.literal(true) })
  })
})

const replySchema = z.object({ html_url: z.string() })

export type ReviewThreadRef = PullRequestHeadRef & { threadId: string }

type GithubPostParams = { url: string; body: unknown }

type GraphqlPost = {
  query: string
  variables: Record<string, unknown>
  subject: string
}

export function createReviewThreadWriter(token: string) {
  const { pacedFetch, [Symbol.dispose]: dispose } = createPacedFetch({
    ...githubPacing(token),
    subject: 'the review thread tools',
    requestsPerMinute: REQUESTS_PER_MINUTE,
    maxAttempts: 1
  })

  const post = async ({ url, body }: GithubPostParams) => {
    return pacedFetch(url, {
      method: 'POST',
      headers: {
        accept: GITHUB_JSON_MEDIA_TYPE,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    })
  }

  const postGraphql = async <Schema extends z.ZodType>(
    { query, variables, subject }: GraphqlPost,
    dataSchema: Schema
  ): Promise<z.infer<Schema>> => {
    const answer = await post({
      url: GITHUB_GRAPHQL_URL,
      body: { query, variables }
    })

    return graphqlDataOf({ ...answer, subject }, dataSchema)
  }

  const readTarget = async ({ threadId, ...head }: ReviewThreadRef) => {
    const { owner, name } = splitRepository(head.repository)
    const { repository, node } = await postGraphql(
      {
        query: REVIEW_THREAD_TARGET_QUERY,
        variables: { owner, name, branch: head.branch, threadId },
        subject: `the read of the review thread ${threadId}`
      },
      reviewThreadTargetSchema
    )
    const [pullRequest] = repository?.pullRequests.nodes ?? []

    if (pullRequest === undefined) {
      return { refusal: REVIEW_THREADS_TEXT.noPullRequest(head) }
    }

    const thread = node?.pullRequest.id === pullRequest.id ? node : undefined
    const [opening] = thread?.comments.nodes ?? []

    return thread === undefined || opening === undefined
      ? {
          refusal: REVIEW_THREADS_TEXT.outsidePullRequest(
            threadId,
            pullRequest.number
          )
        }
      : {
          pullRequestNumber: pullRequest.number,
          commentId: opening.fullDatabaseId,
          isResolved: thread.isResolved
        }
  }

  const reply = async ({
    body,
    ...ref
  }: ReviewThreadRef & { body: string }) => {
    const target = await readTarget(ref)

    if ('refusal' in target) {
      return target.refusal
    }

    const { status, text } = await post({
      url: `${GITHUB_REST_URL}/repos/${ref.repository}/pulls/${target.pullRequestNumber}/comments/${target.commentId}/replies`,
      body: { body }
    })

    if (status !== CREATED_STATUS) {
      throw new Error(
        `GitHub answered ${status} to the reply on ${ref.threadId}: ${text}`
      )
    }

    return REVIEW_THREADS_TEXT.replied(
      replySchema.parse(JSON.parse(text)).html_url
    )
  }

  const resolve = async (ref: ReviewThreadRef) => {
    const target = await readTarget(ref)

    if ('refusal' in target) {
      return target.refusal
    }

    if (target.isResolved) {
      return REVIEW_THREADS_TEXT.alreadyResolved(ref.threadId)
    }

    await postGraphql(
      {
        query: RESOLVE_MUTATION,
        variables: { threadId: ref.threadId },
        subject: `the resolve of the review thread ${ref.threadId}`
      },
      resolvedThreadSchema
    )

    return REVIEW_THREADS_TEXT.resolved(ref.threadId)
  }

  return {
    reply,
    resolve,
    [Symbol.dispose]: dispose
  }
}

export type ReviewThreadWriter = ReturnType<typeof createReviewThreadWriter>
