import { REVIEW_THREADS_TEXT } from '#/prompts/github.ts'
import type { PullRequestHeadRef } from './github-api.ts'
import { splitRepository, type GithubOctokit } from './github-octokit.ts'

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

type ReviewThreadTargetData = {
  repository: {
    pullRequests: { nodes: { id: string; number: number }[] }
  } | null
  node: Partial<{
    isResolved: boolean
    pullRequest: { id: string }
    comments: { nodes: { fullDatabaseId: string }[] }
  }> | null
}

export type ReviewThreadRef = PullRequestHeadRef & { threadId: string }

export function createReviewThreadWriter(octokit: GithubOctokit) {
  const readTarget = async ({ threadId, ...head }: ReviewThreadRef) => {
    const { owner, repo } = splitRepository(head.repository)
    const { repository, node } = await octokit.graphql<ReviewThreadTargetData>(
      REVIEW_THREAD_TARGET_QUERY,
      { owner, name: repo, branch: head.branch, threadId }
    )
    const [pullRequest] = repository?.pullRequests.nodes ?? []

    if (pullRequest === undefined) {
      return { refusal: REVIEW_THREADS_TEXT.noPullRequest(head) }
    }

    const thread = node?.pullRequest?.id === pullRequest.id ? node : undefined
    const [opening] = thread?.comments?.nodes ?? []

    return thread === undefined || opening === undefined
      ? {
          refusal: REVIEW_THREADS_TEXT.outsidePullRequest(
            threadId,
            pullRequest.number
          )
        }
      : {
          owner,
          repo,
          pullRequestNumber: pullRequest.number,
          commentId: Number(opening.fullDatabaseId),
          isResolved: thread.isResolved === true
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

    const { data } = await octokit.request(
      'POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies',
      {
        owner: target.owner,
        repo: target.repo,
        pull_number: target.pullRequestNumber,
        comment_id: target.commentId,
        body,
        request: { retries: 0 }
      }
    )

    return REVIEW_THREADS_TEXT.replied(data.html_url)
  }

  const resolve = async (ref: ReviewThreadRef) => {
    const target = await readTarget(ref)

    if ('refusal' in target) {
      return target.refusal
    }

    if (target.isResolved) {
      return REVIEW_THREADS_TEXT.alreadyResolved(ref.threadId)
    }

    await octokit.graphql(RESOLVE_MUTATION, { threadId: ref.threadId })

    return REVIEW_THREADS_TEXT.resolved(ref.threadId)
  }

  return { reply, resolve }
}

export type ReviewThreadWriter = ReturnType<typeof createReviewThreadWriter>
