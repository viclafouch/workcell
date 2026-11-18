import type {
  Actor,
  Commit,
  GitActor,
  Maybe,
  PullRequest,
  PullRequestReviewComment,
  PullRequestReviewCommentConnection,
  PullRequestReviewThread,
  PullRequestReviewThreadConnection,
  User
} from '@octokit/graphql-schema'
import type { PageInfoForward } from '@octokit/plugin-paginate-graphql'
import { REVIEW_THREADS_TEXT } from '#/prompts/github.ts'
import type { PullRequestHeadRef } from './github-api.ts'
import {
  splitRepository,
  undefinedOnStatus,
  type GithubOctokit
} from './github-octokit.ts'

const FILES_PER_PAGE = 100

const MAX_BODY_CHARS = 4_000

const MAX_PATCH_CHARS = 20_000

const MAX_MESSAGE_CHARS = 1_000

const MAX_PAGE_LINES = 1_900

const BYTES_PER_KIB = 1024

const MAX_PAGE_KIB = 48

const MAX_PAGE_BYTES = MAX_PAGE_KIB * BYTES_PER_KIB

const NOT_FOUND_STATUS = 404

const DEFAULT_HISTORY_LIMIT = 10

const REVIEW_THREADS_PER_PAGE = 100

const MAX_THREAD_COMMENTS = 50

const MAX_COMMENT_CHARS = 20_000

const DELETED_GITHUB_USER = 'ghost'

const FILE_HISTORY_QUERY = `query FileHistory($owner: String!, $name: String!, $expression: String!, $path: String!, $first: Int!) {
  repository(owner: $owner, name: $name) {
    object(expression: $expression) {
      ... on Commit {
        history(path: $path, first: $first) {
          nodes {
            oid
            committedDate
            messageHeadline
            messageBody
            author { name user { login } }
            associatedPullRequests(first: 1) { nodes { number title url } }
          }
        }
      }
    }
  }
}`

const REVIEW_THREADS_QUERY = `query ReviewThreads($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: ${REVIEW_THREADS_PER_PAGE}, after: $cursor) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          comments(first: ${MAX_THREAD_COMMENTS}) {
            totalCount
            nodes { author { login } body url }
          }
        }
      }
    }
  }
}`

type FileHistoryData = {
  repository: Maybe<{
    object: Maybe<{
      history: {
        nodes: (Pick<Commit, 'messageHeadline' | 'messageBody'> & {
          oid: string
          committedDate: string
          author: Maybe<
            Pick<GitActor, 'name'> & { user: Maybe<Pick<User, 'login'>> }
          >
          associatedPullRequests: {
            nodes: (Pick<PullRequest, 'number' | 'title'> & { url: string })[]
          }
        })[]
      }
    }>
  }>
}

type ReviewComment = Pick<PullRequestReviewComment, 'body'> & {
  url: string
  author: Maybe<Pick<Actor, 'login'>>
}

type ReviewThread = Pick<
  PullRequestReviewThread,
  'id' | 'isResolved' | 'isOutdated' | 'path' | 'line' | 'originalLine'
> & {
  comments: Pick<PullRequestReviewCommentConnection, 'totalCount'> & {
    nodes: ReviewComment[]
  }
}

type ReviewThreadsData = {
  repository: {
    pullRequest: {
      reviewThreads: Pick<PullRequestReviewThreadConnection, 'totalCount'> & {
        pageInfo: PageInfoForward
        nodes: ReviewThread[]
      }
    }
  }
}

type PullRequestRef = { repository: string; number: number }

type FileRef = { repository: string; path: string }

type LineRange = { offset?: number; limit?: number }

type ReadPullRequestPatchParams = PullRequestRef & { path: string }

function capped(text: string, maxChars: number) {
  return text.length > maxChars
    ? {
        text: text.slice(0, maxChars),
        truncated: true,
        totalChars: text.length
      }
    : { text, truncated: false }
}

function reviewCommentOf({ author, body, url }: ReviewComment) {
  return {
    author: author?.login ?? DELETED_GITHUB_USER,
    body: capped(body, MAX_COMMENT_CHARS),
    url
  }
}

function reviewThreadOf({
  id,
  isOutdated,
  path,
  line,
  originalLine,
  comments
}: ReviewThread) {
  const [opening, ...replies] = comments.nodes.map(reviewCommentOf)

  return {
    threadId: id,
    path,
    line: line ?? originalLine,
    outdated: isOutdated,
    ...opening,
    replies,
    repliesListed: `${replies.length} of ${Math.max(comments.totalCount - 1, 0)}`
  }
}

function pageOf(
  text: string,
  { path, offset = 1, limit }: LineRange & { path: string }
) {
  const lines = text.split('\n')

  if (text.endsWith('\n')) {
    lines.pop()
  }

  const pageLimit = Math.min(limit ?? MAX_PAGE_LINES, MAX_PAGE_LINES)
  const shown: string[] = []
  let bytes = 0

  for (const line of lines.slice(offset - 1, offset - 1 + pageLimit)) {
    bytes += Buffer.byteLength(line) + 1

    if (bytes > MAX_PAGE_BYTES && shown.length > 0) {
      break
    }

    shown.push(line)
  }

  if (shown.length === 0) {
    return `[No lines from line ${offset}. ${path} has ${lines.length} lines.]`
  }

  const last = offset + shown.length - 1
  const isCut = shown.length < (limit ?? Infinity) && last < lines.length

  return isCut
    ? `${shown.join('\n')}\n\n[Showing lines ${offset}-${last} of ${lines.length}. Read more with offset ${last + 1}.]`
    : shown.join('\n')
}

function isRepositoryPath(path: string) {
  return path.split('/').every((segment) => {
    return segment !== '' && segment !== '.' && segment !== '..'
  })
}

function noPullRequest({ repository, number }: PullRequestRef) {
  return `GitHub has no pull request #${number} in ${repository}.`
}

export function createGithubReader(octokit: GithubOctokit) {
  const readPullRequest = async (ref: PullRequestRef) => {
    const { owner, repo } = splitRepository(ref.repository)
    const found = await undefinedOnStatus(
      NOT_FOUND_STATUS,
      octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
        owner,
        repo,
        pull_number: ref.number
      })
    )

    if (found === undefined) {
      return noPullRequest(ref)
    }

    const { data: pullRequest } = found
    const { data: files } = await octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/files',
      { owner, repo, pull_number: ref.number, per_page: FILES_PER_PAGE }
    )

    return {
      number: pullRequest.number,
      url: pullRequest.html_url,
      title: pullRequest.title,
      author: pullRequest.user.login,
      state: pullRequest.merged ? 'merged' : pullRequest.state,
      draft: pullRequest.draft,
      base: pullRequest.base.ref,
      head: pullRequest.head.ref,
      additions: pullRequest.additions,
      deletions: pullRequest.deletions,
      changedFiles: pullRequest.changed_files,
      body: capped(pullRequest.body ?? '', MAX_BODY_CHARS),
      files: files.map(
        ({ filename, previous_filename, status, additions, deletions }) => {
          return {
            path: filename,
            previousPath: previous_filename,
            status,
            additions,
            deletions
          }
        }
      ),
      filesListed: `${files.length} of ${pullRequest.changed_files}`
    }
  }

  const readPullRequestPatch = async ({
    path,
    ...ref
  }: ReadPullRequestPatchParams) => {
    const { owner, repo } = splitRepository(ref.repository)
    const matches = await undefinedOnStatus(
      NOT_FOUND_STATUS,
      octokit.paginate(
        'GET /repos/{owner}/{repo}/pulls/{pull_number}/files',
        { owner, repo, pull_number: ref.number, per_page: FILES_PER_PAGE },
        ({ data: files }, done) => {
          const file = files.find(({ filename, previous_filename }) => {
            return filename === path || previous_filename === path
          })

          if (file === undefined) {
            return []
          }

          done()

          return [file]
        }
      )
    )

    if (matches === undefined) {
      return noPullRequest(ref)
    }

    const [file] = matches

    if (file === undefined) {
      return `Pull request #${ref.number} of ${ref.repository} changes no file ${path}.`
    }

    return file.patch === undefined
      ? `GitHub gives no patch for ${path}: the file is binary or its diff is too large.`
      : { path: file.filename, patch: capped(file.patch, MAX_PATCH_CHARS) }
  }

  const readFile = async ({
    repository,
    path,
    ref,
    ...range
  }: FileRef & LineRange & { ref: string }) => {
    if (!isRepositoryPath(path)) {
      return `${path} is not a file path of ${repository}: each part of the path names a folder or the file.`
    }

    const { owner, repo } = splitRepository(repository)
    const found = await undefinedOnStatus(
      NOT_FOUND_STATUS,
      octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner,
        repo,
        path,
        ref,
        mediaType: { format: 'raw' }
      })
    )

    if (found === undefined) {
      return `GitHub has no file ${path} on ${ref} in ${repository}.`
    }

    const { data } = found

    return pageOf(typeof data === 'string' ? data : JSON.stringify(data), {
      path,
      ...range
    })
  }

  const readFileHistory = async ({
    repository,
    path,
    ref = 'HEAD',
    limit = DEFAULT_HISTORY_LIMIT
  }: FileRef & { ref?: string; limit?: number }) => {
    const { owner, repo } = splitRepository(repository)
    const { repository: found } = await octokit.graphql<FileHistoryData>(
      FILE_HISTORY_QUERY,
      { owner, name: repo, expression: ref, path, first: limit }
    )
    const commits = found?.object?.history.nodes

    if (commits === undefined) {
      return `GitHub has no ref ${ref} in ${repository}.`
    }

    if (commits.length === 0) {
      return `No commit on ${ref} of ${repository} changes ${path}.`
    }

    return commits.map(
      ({
        oid,
        committedDate,
        messageHeadline,
        messageBody,
        author,
        associatedPullRequests
      }) => {
        return {
          sha: oid,
          date: committedDate,
          author: author?.user?.login ?? author?.name,
          headline: messageHeadline,
          body: capped(messageBody, MAX_MESSAGE_CHARS),
          pullRequest: associatedPullRequests.nodes[0]
        }
      }
    )
  }

  const openPullRequestOf = async ({
    repository,
    branch
  }: PullRequestHeadRef) => {
    const { owner, repo } = splitRepository(repository)
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
      owner,
      repo,
      state: 'open',
      head: `${owner}:${branch}`,
      per_page: 1
    })

    return data[0]
  }

  const openPullRequestUrl = async (head: PullRequestHeadRef) => {
    const open = await openPullRequestOf(head)

    return open?.html_url
  }

  const readReviewThreads = async (head: PullRequestHeadRef) => {
    const open = await openPullRequestOf(head)

    if (open === undefined) {
      return REVIEW_THREADS_TEXT.noPullRequest(head)
    }

    const { owner, repo } = splitRepository(head.repository)
    const { repository } = await octokit.graphql.paginate<ReviewThreadsData>(
      REVIEW_THREADS_QUERY,
      { owner, name: repo, number: open.number }
    )
    const { totalCount, nodes: threads } = repository.pullRequest.reviewThreads
    const unresolvedThreads = threads.filter(({ isResolved }) => {
      return !isResolved
    })

    return {
      pullRequest: open.html_url,
      threadsRead: `${threads.length} of ${totalCount}`,
      resolvedThreads: threads.length - unresolvedThreads.length,
      unresolvedThreads: unresolvedThreads.map(reviewThreadOf)
    }
  }

  return {
    readPullRequest,
    readPullRequestPatch,
    openPullRequestUrl,
    readFile,
    readFileHistory,
    readReviewThreads
  }
}

export type GithubReader = ReturnType<typeof createGithubReader>
