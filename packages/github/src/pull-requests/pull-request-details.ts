import { z } from 'zod'
import type {
  Actor,
  Label,
  Maybe,
  MergeStateStatus,
  PatchStatus,
  PullRequest,
  PullRequestReviewState as GithubReviewState,
  PullRequestChangedFile,
  StatusCheckRollupContextConnection,
  StatusContext,
  StatusState
} from '@octokit/graphql-schema'
import type {
  PullRequestCheck,
  PullRequestCheckState,
  PullRequestDetails,
  PullRequestFileStatus,
  PullRequestMergeStatus,
  PullRequestPerson,
  PullRequestReviewer,
  PullRequestReviewState,
  PullRequests
} from '@workcell/core'
import { undefinedOnStatus, type GithubOctokit } from '#/api/github-octokit.ts'
import { GITHUB_MARK } from './github-mark.ts'

const FILES_SHOWN = 100

const ACTIONS_PAGE_SIZE = 100

const NOT_FOUND_STATUS = 404

const FORBIDDEN_STATUS = 403

const NO_ACTIONS_CHECKS: ActionsChecks = { shown: [], seen: 0 }

const PULL_REQUEST_LINK = new URLPattern({
  protocol: 'https',
  hostname: 'github.com',
  pathname: '/:owner/:repo/pull/:number'
})

const PEOPLE_SHOWN = 20

const PULL_REQUEST_QUERY = `query PullRequestDetails($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number title body url state isDraft mergedAt closedAt updatedAt mergeStateStatus isInMergeQueue
      comments { totalCount }
      mergedBy { login avatarUrl }
      mergeCommit { oid }
      author { login avatarUrl }
      assignees(first: ${PEOPLE_SHOWN}) { nodes { login avatarUrl } }
      labels(first: ${PEOPLE_SHOWN}) { nodes { name color } }
      reviewRequests(first: ${PEOPLE_SHOWN}) {
        nodes {
          requestedReviewer {
            __typename
            ... on User { login avatarUrl }
            ... on Team { name }
          }
        }
      }
      latestReviews(first: ${PEOPLE_SHOWN}) { nodes { state author { login avatarUrl } } }
      commitCount: commits { totalCount }
      baseRefName headRefName headRefOid additions deletions changedFiles
      files(first: ${FILES_SHOWN}) { nodes { path changeType additions deletions } }
      commits(last: 1) {
        nodes {
          commit {
            status { contexts { context state targetUrl description } }
            statusCheckRollup { contexts { checkRunCount } }
          }
        }
      }
    }
  }
}`

const STATUS_STATES = {
  EXPECTED: 'pending',
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILURE: 'failure',
  ERROR: 'failure'
} as const satisfies Record<StatusState, PullRequestCheckState>

const JOB_CONCLUSIONS = new Map<string, PullRequestCheckState>([
  ['success', 'success'],
  ['failure', 'failure'],
  ['timed_out', 'failure'],
  ['startup_failure', 'failure'],
  ['cancelled', 'cancelled'],
  ['skipped', 'skipped'],
  ['neutral', 'neutral'],
  ['stale', 'neutral'],
  ['action_required', 'pending']
])

const MERGE_STATUSES = {
  CLEAN: 'ready',
  HAS_HOOKS: 'ready',
  BLOCKED: 'blocked',
  UNSTABLE: 'checks-failing',
  DIRTY: 'conflicts',
  BEHIND: 'behind',
  DRAFT: 'blocked',
  UNKNOWN: 'unknown'
} as const satisfies Record<MergeStateStatus, PullRequestMergeStatus>

const REVIEW_STATES = new Map<GithubReviewState, PullRequestReviewState>([
  ['APPROVED', 'approved'],
  ['CHANGES_REQUESTED', 'changes-requested'],
  ['COMMENTED', 'commented']
])

const FILE_STATUSES = {
  ADDED: 'added',
  DELETED: 'removed',
  MODIFIED: 'modified',
  RENAMED: 'renamed',
  COPIED: 'copied',
  CHANGED: 'changed'
} as const satisfies Record<PatchStatus, PullRequestFileStatus>

type Person = Maybe<Pick<Actor, 'login'> & { avatarUrl: string }>

type RequestedReviewer = Maybe<
  | { __typename: 'User'; login: string; avatarUrl: string }
  | { __typename: 'Team'; name: string }
  | { __typename: 'Bot' | 'Mannequin' }
>

type DetailsNode = Pick<
  PullRequest,
  | 'number'
  | 'title'
  | 'body'
  | 'state'
  | 'isDraft'
  | 'baseRefName'
  | 'headRefName'
  | 'additions'
  | 'deletions'
  | 'changedFiles'
  | 'mergeStateStatus'
  | 'isInMergeQueue'
> & {
  url: string
  updatedAt: string
  comments: { totalCount: number }
  assignees: { nodes: NonNullable<Person>[] }
  labels: Maybe<{ nodes: Pick<Label, 'name' | 'color'>[] }>
  reviewRequests: Maybe<{
    nodes: Maybe<{ requestedReviewer: RequestedReviewer }>[] | null
  }>
  latestReviews: Maybe<{
    nodes: Maybe<{ state: GithubReviewState; author: Person }>[] | null
  }>
  commitCount: { totalCount: number }
  mergedAt: Maybe<string>
  closedAt: Maybe<string>
  headRefOid: string
  mergedBy: Person
  mergeCommit: Maybe<{ oid: string }>
  author: Person
  files: Maybe<{
    nodes: Pick<
      PullRequestChangedFile,
      'path' | 'changeType' | 'additions' | 'deletions'
    >[]
  }>
  commits: {
    nodes: {
      commit: {
        status: Maybe<{
          contexts: (Pick<
            StatusContext,
            'context' | 'state' | 'description'
          > & {
            targetUrl: Maybe<string>
          })[]
        }>
        statusCheckRollup: Maybe<{
          contexts: Pick<StatusCheckRollupContextConnection, 'checkRunCount'>
        }>
      }
    }[]
  }
}

type DetailsData = { repository: Maybe<{ pullRequest: Maybe<DetailsNode> }> }

type PullRequestRef = { owner: string; repo: string; number: number }

type ActionsChecks = { shown: PullRequestCheck[]; seen: number }

const notFoundSchema = z.object({
  errors: z.array(z.object({ type: z.literal('NOT_FOUND') })).nonempty()
})

function refOf(url: string): PullRequestRef | undefined {
  const link = PULL_REQUEST_LINK.exec(url)?.pathname.groups

  if (
    link?.owner === undefined ||
    link.repo === undefined ||
    link.number === undefined
  ) {
    return undefined
  }

  return { owner: link.owner, repo: link.repo, number: Number(link.number) }
}

function personOf(person: Person): PullRequestPerson | undefined {
  return person === null
    ? undefined
    : { name: person.login, avatarUrl: person.avatarUrl }
}

function stateOf({ state, isDraft }: DetailsNode): PullRequestDetails['state'] {
  if (state === 'MERGED') {
    return 'merged'
  }

  if (state === 'CLOSED') {
    return 'closed'
  }

  return isDraft ? 'draft' : 'open'
}

function jobStateOf(
  status: string,
  conclusion: string | null
): PullRequestCheckState {
  return status === 'completed'
    ? (JOB_CONCLUSIONS.get(conclusion ?? '') ?? 'neutral')
    : 'pending'
}

function reviewersOf({
  reviewRequests,
  latestReviews
}: DetailsNode): PullRequestReviewer[] {
  const reviewed = (latestReviews?.nodes ?? []).flatMap((review) => {
    const state = review === null ? undefined : REVIEW_STATES.get(review.state)
    const person = personOf(review?.author ?? null)

    return state === undefined || person === undefined
      ? []
      : [{ ...person, state }]
  })
  const requested = (reviewRequests?.nodes ?? []).flatMap(
    (request): PullRequestReviewer[] => {
      const reviewer = request?.requestedReviewer

      if (reviewer?.__typename === 'User') {
        return [
          {
            name: reviewer.login,
            avatarUrl: reviewer.avatarUrl,
            state: 'requested'
          }
        ]
      }

      return reviewer?.__typename === 'Team'
        ? [
            {
              name: reviewer.name,
              avatarUrl: undefined,
              state: 'requested'
            }
          ]
        : []
    }
  )

  return [
    ...reviewed,
    ...requested.filter(({ name }) => {
      return !reviewed.some((reviewer) => {
        return reviewer.name === name
      })
    })
  ]
}

function mergeStatusOf(node: DetailsNode) {
  return stateOf(node) === 'open'
    ? MERGE_STATUSES[node.mergeStateStatus]
    : undefined
}

export function githubPullRequests(octokit: GithubOctokit): PullRequests {
  const readNode = async ({ owner, repo, number }: PullRequestRef) => {
    try {
      const { repository } = await octokit.graphql<DetailsData>(
        PULL_REQUEST_QUERY,
        { owner, name: repo, number }
      )

      return repository?.pullRequest ?? null
    } catch (error) {
      if (notFoundSchema.safeParse(error).success) {
        return null
      }

      throw error
    }
  }

  const readActionsChecks = async (
    { owner, repo }: PullRequestRef,
    headSha: string
  ): Promise<ActionsChecks> => {
    const found = await undefinedOnStatus(
      FORBIDDEN_STATUS,
      octokit.request('GET /repos/{owner}/{repo}/actions/runs', {
        owner,
        repo,
        head_sha: headSha,
        per_page: ACTIONS_PAGE_SIZE
      })
    )

    if (found === undefined) {
      return NO_ACTIONS_CHECKS
    }

    const newestFirst = found.data.workflow_runs.toSorted((first, second) => {
      return Number(second.id) - Number(first.id)
    })
    const runs = await Promise.all(
      newestFirst.map(async (run, index) => {
        const { data: jobsOfRun } = await octokit.request(
          'GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs',
          {
            owner,
            repo,
            run_id: Number(run.id),
            filter: 'all',
            per_page: ACTIONS_PAGE_SIZE
          }
        )
        const isLatestOfItsWorkflow =
          newestFirst.findIndex(({ workflow_id, event }) => {
            return workflow_id === run.workflow_id && event === run.event
          }) === index
        const shown = isLatestOfItsWorkflow
          ? jobsOfRun.jobs.filter(({ run_attempt }) => {
              return run_attempt === run.run_attempt
            })
          : []

        return {
          seen: jobsOfRun.total_count,
          shown: shown.map(({ name, status, conclusion, html_url }) => {
            return {
              name,
              state: jobStateOf(status, conclusion),
              url: html_url ?? undefined
            }
          })
        }
      })
    )

    return {
      shown: runs.toReversed().flatMap(({ shown }) => {
        return shown
      }),
      seen: runs.reduce((total, { seen }) => {
        return total + seen
      }, 0)
    }
  }

  const read = async (url: string): Promise<PullRequestDetails | null> => {
    const ref = refOf(url)

    if (ref === undefined) {
      return null
    }

    const node = await readNode(ref)

    if (node === null) {
      return null
    }

    const [{ commit } = { commit: undefined }] = node.commits.nodes
    const checkRunCount = commit?.statusCheckRollup?.contexts.checkRunCount ?? 0
    const actions =
      checkRunCount === 0
        ? NO_ACTIONS_CHECKS
        : await readActionsChecks(ref, node.headRefOid)
    const statuses = (commit?.status?.contexts ?? []).map(
      ({ context, state, targetUrl, description }): PullRequestCheck => {
        return {
          name: context,
          state: STATUS_STATES[state],
          url: targetUrl ?? undefined,
          description: description ?? undefined
        }
      }
    )

    return {
      key: `#${node.number}`,
      title: node.title,
      url: node.url,
      description: node.body,
      state: stateOf(node),
      author: personOf(node.author),
      assignees: node.assignees.nodes.map((person) => {
        return { name: person.login, avatarUrl: person.avatarUrl }
      }),
      labels: (node.labels?.nodes ?? []).map(({ name, color }) => {
        return { name, color: `#${color}` }
      }),
      reviewers: reviewersOf(node),
      base: node.baseRefName,
      head: node.headRefName,
      headCommit: node.headRefOid,
      commitCount: node.commitCount.totalCount,
      commentCount: node.comments.totalCount,
      updatedAt: node.updatedAt,
      isInMergeQueue: node.isInMergeQueue,
      mergeStatus: mergeStatusOf(node),
      additions: node.additions,
      deletions: node.deletions,
      checks: [...statuses, ...actions.shown],
      hiddenChecks: Math.max(checkRunCount - actions.seen, 0),
      files: (node.files?.nodes ?? []).map(
        ({ path, changeType, additions, deletions }) => {
          return {
            path,
            status: FILE_STATUSES[changeType],
            additions,
            deletions
          }
        }
      ),
      fileCount: node.changedFiles,
      merge:
        node.mergedAt === null
          ? undefined
          : {
              mergedAt: node.mergedAt,
              mergedBy: personOf(node.mergedBy),
              commit: node.mergeCommit?.oid
            },
      closedAt:
        node.state === 'CLOSED' && node.closedAt !== null
          ? node.closedAt
          : undefined
    }
  }

  const diff = async (url: string) => {
    const ref = refOf(url)

    if (ref === undefined) {
      return null
    }

    const found = await undefinedOnStatus(
      NOT_FOUND_STATUS,
      octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.number,
        mediaType: { format: 'diff' }
      })
    )

    if (found === undefined) {
      return null
    }

    if (typeof found.data !== 'string') {
      throw new TypeError(`GitHub answered the diff of ${url} with no diff.`)
    }

    return found.data
  }

  return { mark: GITHUB_MARK, read, diff }
}
