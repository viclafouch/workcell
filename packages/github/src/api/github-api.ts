import type {
  Actor,
  AddedToMergeQueueEvent,
  Bot,
  CheckRunStateCount,
  EnterpriseUserAccount,
  StatusContext as GithubStatusContext,
  IssueComment,
  Mannequin,
  Maybe,
  Organization,
  PullRequest,
  PullRequestReview,
  PullRequestReviewThread,
  RemovedFromMergeQueueEvent,
  StatusCheckRollup,
  StatusCheckRollupContextConnection,
  User
} from '@octokit/graphql-schema'
import { splitRepository, type GithubOctokit } from './github-octokit.ts'

const ACTIONS_PAGE_SIZE = 100

const RUN_CONCLUSIONS_WITHOUT_FAILURE = new Set([
  'success',
  'neutral',
  'skipped'
])

const FAILED_JOB_CONCLUSIONS = new Set(['failure', 'timed_out'])

type ActorKind = Bot | EnterpriseUserAccount | Mannequin | Organization | User

export type Author = Maybe<
  Pick<Actor, 'login'> & Required<Pick<ActorKind, '__typename'>>
>

export type StatusContext = Pick<
  GithubStatusContext,
  'id' | 'context' | 'state' | 'description'
> & { targetUrl: string | null }

type Comment = Pick<IssueComment, 'id'> & {
  url: string
  createdAt: string
  author: Author
}

type TimelineItem =
  | Required<Pick<AddedToMergeQueueEvent, '__typename' | 'id'>>
  | (Required<Pick<RemovedFromMergeQueueEvent, '__typename' | 'id'>> &
      Pick<RemovedFromMergeQueueEvent, 'reason'>)

export type WatchedPullRequest = Pick<
  PullRequest,
  'number' | 'merged' | 'closed' | 'mergeable'
> & {
  url: string
  headRefOid: string
  mergeCommit: Maybe<{ oid: string }>
  statusCheckRollup: Maybe<
    Pick<StatusCheckRollup, 'state'> & {
      contexts: Pick<
        StatusCheckRollupContextConnection,
        'checkRunCountsByState'
      > & {
        checkRunCountsByState: Maybe<
          Pick<CheckRunStateCount, 'state' | 'count'>[]
        >
      }
    }
  >
  commits: {
    nodes: {
      commit: {
        committedDate: string
        status: Maybe<{ contexts: StatusContext[] }>
      }
    }[]
  }
  reviewThreads: {
    nodes: (Pick<PullRequestReviewThread, 'isResolved'> & {
      comments: { nodes: Comment[] }
    })[]
  }
  comments: { nodes: Comment[] }
  reviews: {
    nodes: (Comment & Pick<PullRequestReview, 'state' | 'body'>)[]
  }
  timelineItems: { nodes: TimelineItem[] }
}

type PullRequestSelection =
  | {
      pullRequests: { nodes: (Pick<PullRequest, 'number'> & { url: string })[] }
    }
  | { pullRequest: WatchedPullRequest | null }

type WatchData = { viewer: Pick<User, 'login'> } & Record<
  `pr${number}`,
  PullRequestSelection
>

export type PullRequestHeadRef = { repository: string; branch: string }

type ReadFailedJobsParams = { repository: string; headSha: string }

export type FailedJob = { name: string; url: string }

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

const WATCHED_PULL_REQUEST_FIELDS = `number url merged closed mergeable headRefOid
      mergeCommit { oid }
      statusCheckRollup { state contexts { checkRunCountsByState { state count } } }
      commits(last: 1) {
        nodes { commit { committedDate status { contexts { id context state description targetUrl } } } }
      }
      reviewThreads(last: 50) {
        nodes { isResolved comments(last: 20) { nodes { id url createdAt author { __typename login } } } }
      }
      comments(last: 50) { nodes { id url createdAt author { __typename login } } }
      reviews(last: 30) { nodes { id url createdAt state body author { __typename login } } }
      timelineItems(last: 20, itemTypes: [ADDED_TO_MERGE_QUEUE_EVENT, REMOVED_FROM_MERGE_QUEUE_EVENT]) {
        nodes {
          __typename
          ... on AddedToMergeQueueEvent { id }
          ... on RemovedFromMergeQueueEvent { id reason }
        }
      }`

function watchQuery(heads: readonly PullRequestHead[]) {
  const declarations: string[] = []
  const selections: string[] = []
  const variables: Record<string, unknown> = {}

  for (const [index, { repository, branch, number }] of heads.entries()) {
    const { owner, repo } = splitRepository(repository)
    variables[`owner${index}`] = owner
    variables[`name${index}`] = repo
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
    pullRequest(number: $number${index}) { ${WATCHED_PULL_REQUEST_FIELDS} }
  }`)
    }
  }

  return {
    query: `query WatchedPullRequests(${declarations.join(', ')}) {
  viewer { login }
  ${selections.join('\n  ')}
}`,
    variables
  }
}

function readOf(selection: PullRequestSelection | undefined): PullRequestRead {
  if (selection !== undefined && 'pullRequests' in selection) {
    const [found] = selection.pullRequests.nodes

    return found === undefined
      ? { found: false }
      : { found: true, ...found, pullRequest: undefined }
  }

  const pullRequest = selection?.pullRequest ?? null

  return pullRequest === null
    ? { found: false }
    : {
        found: true,
        number: pullRequest.number,
        url: pullRequest.url,
        pullRequest
      }
}

export function createGithubApi(octokit: GithubOctokit) {
  const readPullRequests = async (heads: readonly PullRequestHead[]) => {
    const { query, variables } = watchQuery(heads)
    const data = await octokit.graphql<WatchData>(query, variables)

    return {
      viewerLogin: data.viewer.login,
      reads: heads.map((_, index) => {
        return readOf(data[`pr${index}`])
      })
    }
  }

  const readFailedJobs = async ({
    repository,
    headSha
  }: ReadFailedJobsParams): Promise<FailedJob[]> => {
    const { owner, repo } = splitRepository(repository)
    const { data } = await octokit.request(
      'GET /repos/{owner}/{repo}/actions/runs',
      {
        owner,
        repo,
        head_sha: headSha,
        exclude_pull_requests: true,
        per_page: ACTIONS_PAGE_SIZE
      }
    )
    const newestFirst = data.workflow_runs.toSorted((first, second) => {
      return Number(second.id) - Number(first.id)
    })
    const latestRuns = newestFirst.filter((run, index) => {
      return (
        newestFirst.findIndex(({ workflow_id, event }) => {
          return workflow_id === run.workflow_id && event === run.event
        }) === index
      )
    })
    const runsToRead = latestRuns.filter(({ conclusion }) => {
      return !RUN_CONCLUSIONS_WITHOUT_FAILURE.has(conclusion ?? '')
    })
    const jobsOfRuns = await Promise.all(
      runsToRead.map(async ({ id }) => {
        const { data: jobsOfRun } = await octokit.request(
          'GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs',
          {
            owner,
            repo,
            run_id: Number(id),
            filter: 'latest',
            per_page: ACTIONS_PAGE_SIZE
          }
        )

        return jobsOfRun.jobs
      })
    )

    return jobsOfRuns
      .flat()
      .filter(({ conclusion }) => {
        return FAILED_JOB_CONCLUSIONS.has(conclusion ?? '')
      })
      .flatMap(({ name: jobName, html_url }) => {
        return html_url === null ? [] : [{ name: jobName, url: html_url }]
      })
  }

  return { readPullRequests, readFailedJobs }
}

export type GithubApi = ReturnType<typeof createGithubApi>
