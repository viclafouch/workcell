import { z } from 'zod'
import { createPacedFetch, type PacedRequest } from '@workcell/core'
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

const REQUESTS_PER_MINUTE = 30

const FILES_PER_PAGE = 100

const MAX_FILE_PAGES = 30

const MAX_BODY_CHARS = 4_000

const MAX_PATCH_CHARS = 20_000

const MAX_MESSAGE_CHARS = 1_000

const MAX_PAGE_LINES = 1_900

const BYTES_PER_KIB = 1024

const MAX_PAGE_KIB = 48

const MAX_PAGE_BYTES = MAX_PAGE_KIB * BYTES_PER_KIB

const OK_STATUS = 200

const NOT_FOUND_STATUS = 404

const DEFAULT_HISTORY_LIMIT = 10

const REVIEW_THREADS_PER_PAGE = 100

const MAX_REVIEW_THREAD_PAGES = 10

const MAX_THREAD_COMMENTS = 50

const MAX_COMMENT_CHARS = 20_000

const DELETED_GITHUB_USER = 'ghost'

const RAW_MEDIA_TYPE = 'application/vnd.github.raw+json'

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

const REVIEW_THREADS_QUERY = `query ReviewThreads($owner: String!, $name: String!, $branch: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $branch, first: 1, states: [OPEN], orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes {
        url
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
  }
}`

const pullRequestSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.string(),
  draft: z.boolean(),
  merged: z.boolean(),
  html_url: z.string(),
  user: z.object({ login: z.string() }).nullable(),
  base: z.object({ ref: z.string() }),
  head: z.object({ ref: z.string() }),
  additions: z.number(),
  deletions: z.number(),
  changed_files: z.number()
})

const pullRequestFilesSchema = z.array(
  z.object({
    filename: z.string(),
    previous_filename: z.string().optional(),
    status: z.string(),
    additions: z.number(),
    deletions: z.number(),
    patch: z.string().optional()
  })
)

const fileHistorySchema = z.object({
  repository: z
    .object({
      object: z
        .object({
          history: z.object({
            nodes: z.array(
              z.object({
                oid: z.string(),
                committedDate: z.string(),
                messageHeadline: z.string(),
                messageBody: z.string(),
                author: z
                  .object({
                    name: z.string().nullable(),
                    user: z.object({ login: z.string() }).nullable()
                  })
                  .nullable(),
                associatedPullRequests: z.object({
                  nodes: z.array(
                    z.object({
                      number: z.number(),
                      title: z.string(),
                      url: z.string()
                    })
                  )
                })
              })
            )
          })
        })
        .nullable()
    })
    .nullable()
})

const reviewCommentSchema = z.object({
  author: z.object({ login: z.string() }).nullable(),
  body: z.string(),
  url: z.string()
})

const reviewThreadSchema = z.object({
  id: z.string(),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  path: z.string(),
  line: z.number().nullable(),
  originalLine: z.number().nullable(),
  comments: z.object({
    totalCount: z.number(),
    nodes: z.array(reviewCommentSchema)
  })
})

const reviewThreadsPageSchema = z.object({
  url: z.string(),
  reviewThreads: z.object({
    totalCount: z.number(),
    pageInfo: z.object({
      hasNextPage: z.boolean(),
      endCursor: z.string().nullable()
    }),
    nodes: z.array(reviewThreadSchema)
  })
})

const reviewThreadsSchema = z.object({
  repository: z
    .object({
      pullRequests: z.object({ nodes: z.array(reviewThreadsPageSchema) })
    })
    .nullable()
})

const openPullRequestsSchema = z.array(z.object({ html_url: z.string() }))

type GithubRead =
  | { kind: 'rest'; path: string; mediaType: string }
  | { kind: 'graphql'; query: string; variables: Record<string, unknown> }

type GraphqlRead = {
  query: string
  variables: Record<string, unknown>
  subject: string
}

type PullRequestRef = { repository: string; number: number }

type FileRef = { repository: string; path: string }

type LineRange = { offset?: number; limit?: number }

type ReviewCommentParams = z.infer<typeof reviewCommentSchema>

type ReviewThread = z.infer<typeof reviewThreadSchema>

type ReviewThreadsPage = z.infer<typeof reviewThreadsPageSchema>

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

function reviewCommentOf({ author, body, url }: ReviewCommentParams) {
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

function reviewThreadsAnswer(
  { url, reviewThreads }: ReviewThreadsPage,
  threads: readonly ReviewThread[]
) {
  const unresolvedThreads = threads.filter(({ isResolved }) => {
    return !isResolved
  })

  return {
    pullRequest: url,
    threadsRead: `${threads.length} of ${reviewThreads.totalCount}`,
    resolvedThreads: threads.length - unresolvedThreads.length,
    unresolvedThreads: unresolvedThreads.map(reviewThreadOf)
  }
}

function encodedPath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/')
}

function requestOf(read: GithubRead): { url: string; init: PacedRequest } {
  return read.kind === 'rest'
    ? {
        url: `${GITHUB_REST_URL}${read.path}`,
        init: { headers: { accept: read.mediaType } }
      }
    : {
        url: GITHUB_GRAPHQL_URL,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: read.query, variables: read.variables })
        }
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

export function createGithubReader(token: string) {
  const { pacedFetch, [Symbol.dispose]: dispose } = createPacedFetch({
    ...githubPacing(token),
    subject: 'the GitHub reads',
    requestsPerMinute: REQUESTS_PER_MINUTE
  })

  const read = async (githubRead: GithubRead) => {
    const { url, init } = requestOf(githubRead)

    return pacedFetch(url, init)
  }

  const readRest = async (path: string, mediaType = GITHUB_JSON_MEDIA_TYPE) => {
    const { status, text } = await read({ kind: 'rest', path, mediaType })

    if (status === NOT_FOUND_STATUS) {
      return
    }

    if (status !== OK_STATUS) {
      throw new Error(`GitHub answered ${status} to ${path}.`)
    }

    return text
  }

  const readGraphql = async <Schema extends z.ZodType>(
    { query, variables, subject }: GraphqlRead,
    dataSchema: Schema
  ): Promise<z.infer<Schema>> => {
    const answer = await read({ kind: 'graphql', query, variables })

    return graphqlDataOf({ ...answer, subject }, dataSchema)
  }

  const readFilesPage = async (
    { repository, number }: PullRequestRef,
    page: number
  ) => {
    const query = new URLSearchParams({
      per_page: String(FILES_PER_PAGE),
      page: String(page)
    })
    const text = await readRest(
      `/repos/${repository}/pulls/${number}/files?${query.toString()}`
    )

    return text === undefined
      ? undefined
      : pullRequestFilesSchema.parse(JSON.parse(text))
  }

  const readPullRequest = async (ref: PullRequestRef) => {
    const text = await readRest(`/repos/${ref.repository}/pulls/${ref.number}`)

    if (text === undefined) {
      return noPullRequest(ref)
    }

    const files = (await readFilesPage(ref, 1)) ?? []

    const pullRequest = pullRequestSchema.parse(JSON.parse(text))

    return {
      number: pullRequest.number,
      url: pullRequest.html_url,
      title: pullRequest.title,
      author: pullRequest.user?.login,
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
    for (let page = 1; page <= MAX_FILE_PAGES; page += 1) {
      // oxlint-disable-next-line no-await-in-loop -- the next page loads only when this one misses the file
      const files = await readFilesPage(ref, page)

      if (files === undefined) {
        return noPullRequest(ref)
      }

      const file = files.find(({ filename, previous_filename }) => {
        return filename === path || previous_filename === path
      })

      if (file !== undefined) {
        return file.patch === undefined
          ? `GitHub gives no patch for ${path}: the file is binary or its diff is too large.`
          : { path: file.filename, patch: capped(file.patch, MAX_PATCH_CHARS) }
      }

      if (files.length < FILES_PER_PAGE) {
        break
      }
    }

    return `Pull request #${ref.number} of ${ref.repository} changes no file ${path}.`
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

    const query = new URLSearchParams({ ref })
    const text = await readRest(
      `/repos/${repository}/contents/${encodedPath(path)}?${query.toString()}`,
      RAW_MEDIA_TYPE
    )

    return text === undefined
      ? `GitHub has no file ${path} on ${ref} in ${repository}.`
      : pageOf(text, { path, ...range })
  }

  const readFileHistory = async ({
    repository,
    path,
    ref = 'HEAD',
    limit = DEFAULT_HISTORY_LIMIT
  }: FileRef & { ref?: string; limit?: number }) => {
    const { owner, name } = splitRepository(repository)
    const { repository: found } = await readGraphql(
      {
        query: FILE_HISTORY_QUERY,
        variables: { owner, name, expression: ref, path, first: limit },
        subject: `the history of ${path}`
      },
      fileHistorySchema
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

  const readReviewThreadsPage = async (
    { repository, branch }: PullRequestHeadRef,
    cursor: string | null
  ) => {
    const { owner, name } = splitRepository(repository)
    const { repository: found } = await readGraphql(
      {
        query: REVIEW_THREADS_QUERY,
        variables: { owner, name, branch, cursor },
        subject: `the review threads of ${branch}`
      },
      reviewThreadsSchema
    )

    return found?.pullRequests.nodes[0]
  }

  const readReviewThreadPages = async (head: PullRequestHeadRef) => {
    const pages: ReviewThreadsPage[] = []
    let cursor: string | null = null

    for (let page = 1; page <= MAX_REVIEW_THREAD_PAGES; page += 1) {
      // oxlint-disable-next-line no-await-in-loop -- each page reads from the cursor of the page before it
      const found = await readReviewThreadsPage(head, cursor)

      if (found === undefined) {
        break
      }

      pages.push(found)
      const { hasNextPage, endCursor } = found.reviewThreads.pageInfo

      if (!hasNextPage) {
        break
      }

      cursor = endCursor
    }

    return pages
  }

  const readReviewThreads = async (head: PullRequestHeadRef) => {
    const pages = await readReviewThreadPages(head)
    const [firstPage] = pages

    return firstPage === undefined
      ? REVIEW_THREADS_TEXT.noPullRequest(head)
      : reviewThreadsAnswer(
          firstPage,
          pages.flatMap(({ reviewThreads }) => {
            return reviewThreads.nodes
          })
        )
  }

  const openPullRequestUrl = async ({
    repository,
    branch
  }: PullRequestHeadRef) => {
    const { owner } = splitRepository(repository)
    const query = new URLSearchParams({
      state: 'open',
      head: `${owner}:${branch}`,
      per_page: '1'
    })
    const path = `/repos/${repository}/pulls?${query.toString()}`
    const text = await readRest(path)

    if (text === undefined) {
      throw new Error(`GitHub answered 404 to ${path}.`)
    }

    const [open] = openPullRequestsSchema.parse(JSON.parse(text))

    return open?.html_url
  }

  return {
    readPullRequest,
    readPullRequestPatch,
    openPullRequestUrl,
    readFile,
    readFileHistory,
    readReviewThreads,
    [Symbol.dispose]: dispose
  }
}

export type GithubReader = ReturnType<typeof createGithubReader>
