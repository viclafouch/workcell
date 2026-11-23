export const GITHUB_TOOLS_TEXT = {
  readPullRequest:
    'Read a pull request on GitHub: its title, author, state, branches, description, and the list of the files it changes with their line counts. Read the diff of one file with github_read_pull_request_patch.',
  readPullRequestPatch:
    'Read the diff of one file of a pull request on GitHub. github_read_pull_request lists the files.',
  readFile:
    'Read a file on a branch, a tag or a commit of a repository on GitHub. Use it for any ref other than the default branch: the library holds the default branch. A long file comes back a page at a time: use offset and limit to read other lines.',
  readFileHistory:
    'Read the latest commits that change a file on GitHub, newest first: the sha, date, author, message, and the pull request of each one.',
  repository: 'The repository, as owner/name.',
  number: 'The number of the pull request.',
  path: 'The path of the file from the repository root.',
  ref: 'A branch name, a tag or a commit sha.',
  historyRef:
    'A branch name, a tag or a commit sha. Leave it out for the default branch.',
  limit: 'How many commits to read, newest first.',
  offset: 'The first line to read, from 1.',
  lineLimit: 'The most lines to read.'
}

export function githubPrompt(repositories: readonly string[]) {
  return [
    `You read pull requests, the files of other branches and the history of a file on GitHub with the github_ tools, for ${repositories.join(', ')} only.`,
    'Answer "who changed this, and why" from the commits and their pull requests. You write nothing on GitHub.'
  ].join('\n')
}

export const REVIEW_THREADS_TOOL_NAME = 'github_read_review_threads'

export const REPLY_TOOL_NAME = 'github_reply_review_thread'

export const RESOLVE_TOOL_NAME = 'github_resolve_review_thread'

export const REVIEW_THREADS_TEXT = {
  description:
    'Read the unresolved inline review threads of the open pull request of your branch on GitHub. Each thread gives its threadId, its file, its line, whether it is outdated, the author and body of its first comment, and its replies. It writes nothing on GitHub.',
  reply: `Reply on an inline review thread of the open pull request of your branch on GitHub, under the name of the host developer. ${REVIEW_THREADS_TOOL_NAME} gives the threadId. Write in the language of the comment, and give the proof: the commit of the fix, or a permalink to the code. It leaves the thread open. When a reply fails, read the thread again before you reply again: the reply can be on GitHub already.`,
  resolve: `Resolve an inline review thread of the open pull request of your branch on GitHub, once you replied on it and pushed its fix, if it has one. ${REVIEW_THREADS_TOOL_NAME} gives the threadId.`,
  threadId: `The threadId of the thread, as ${REVIEW_THREADS_TOOL_NAME} gives it.`,
  body: 'The text of the reply, in GitHub Markdown.',
  noBranch:
    'This task has no branch yet, so it has no pull request. Push the branch and open the pull request first.',
  noPullRequest: ({
    repository,
    branch
  }: {
    repository: string
    branch: string
  }) => {
    return `GitHub has no open pull request for the branch ${branch} of ${repository}.`
  },
  outsidePullRequest: (threadId: string, pullRequestNumber: number) => {
    return `${threadId} is not a review thread of your pull request #${pullRequestNumber}. I reply on and resolve the threads of your own pull request only, and wrote nothing on GitHub.`
  },
  replied: (url: string) => {
    return `Replied on the thread: ${url}. Resolve it with ${RESOLVE_TOOL_NAME} once its fix, if it has one, is pushed.`
  },
  resolved: (threadId: string) => {
    return `Resolved the thread ${threadId}.`
  },
  alreadyResolved: (threadId: string) => {
    return `The thread ${threadId} is resolved already. I wrote nothing on GitHub.`
  }
}

export function openPullRequestRefusal(pullRequest: string) {
  return `The pull request ${pullRequest} is still open, so the task goes on. End your turn: a person reviews and merges it, and the merge or their answer reaches you as a new message. To give up the task, close the pull request first.`
}

export function pullRequestFact(pullRequest: string) {
  return `The pull request of this task: ${pullRequest}.`
}

export type MergedPullRequest = {
  pullRequestUrl: string
  subject: string | undefined
}

type PersonCheck = {
  pullRequestUrl: string
  check: string
  checkUrl: string | null
}

export type PullRequestLines = {
  merged: (merge: MergedPullRequest) => string
  greenCheck: (pullRequestUrl: string) => string
  personCheck: (failure: PersonCheck) => string
  mergeQueueEntry: (pullRequestUrl: string) => string
}

export const PULL_REQUEST_LINES: PullRequestLines = {
  merged: ({ pullRequestUrl, subject }) => {
    const subjectLine = subject === undefined ? [] : [`Subject: ${subject}`]

    return [`Merged: ${pullRequestUrl}`, ...subjectLine].join('\n')
  },
  greenCheck: (pullRequestUrl) => {
    return `Checks green: ${pullRequestUrl}`
  },
  personCheck: ({ pullRequestUrl, check, checkUrl }) => {
    return `${check} failed on ${pullRequestUrl}, a person clears it: ${checkUrl ?? 'no link'}`
  },
  mergeQueueEntry: (pullRequestUrl) => {
    return `In the merge queue: ${pullRequestUrl}`
  }
}
