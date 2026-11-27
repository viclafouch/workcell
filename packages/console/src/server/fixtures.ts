import type {
  FeedbackReport,
  PullRequestDetails,
  QueuedTicket,
  TicketDetails,
  WorkerView
} from '@workcell/core'

export const LIVE_FIXTURE_THREAD = 'worker-alpha-login-redirect'

export const BOT_FIXTURE_THREAD = 'bot-standup'

export const MERGED_FIXTURE_THREAD = 'worker-delta-dark-mode'

const LIVE_FIXTURE_PULL_REQUEST = 'https://github.com/acme/web/pull/418'

const MERGED_FIXTURE_PULL_REQUEST = 'https://github.com/acme/web/pull/412'

const FEEDBACK_AGE = Temporal.Duration.from({ minutes: 20 })

const MERGED_AGE = Temporal.Duration.from({ hours: 1 })

const OLDER_FEEDBACK_AGE = Temporal.Duration.from({ hours: 2 })

const BLOCKED_AGE = Temporal.Duration.from({ hours: 3 })

const ASLEEP_AGE = Temporal.Duration.from({ hours: 26 })

const SANDBOX_FAILURE_AGE = Temporal.Duration.from({ minutes: 5 })

const agoInMs = (age: Temporal.Duration) => {
  return Temporal.Now.instant().subtract(age).epochMilliseconds
}

const agoAsText = (age: Temporal.Duration) => {
  return Temporal.Now.instant().subtract(age).toString()
}

export const FIXTURE_CAPACITY = 5

export const FIXTURE_WORKERS: WorkerView[] = [
  {
    threadId: LIVE_FIXTURE_THREAD,
    name: 'Alpha',
    repository: 'acme/web',
    topic: 'ENG-128',
    subject: 'ENG-128',
    originThreadId: BOT_FIXTURE_THREAD,
    lastActiveAt: agoInMs(FEEDBACK_AGE),
    phase: 'tool',
    command: 'pnpm vitest run src/auth',
    turnUsd: 0.18,
    spentUsd: 1.42,
    budgetUsd: 5,
    branch: 'alpha/login-redirect',
    pullRequest: LIVE_FIXTURE_PULL_REQUEST,
    pullRequestRevision: 'revision-1',
    waits: [],
    startupMs: 41_000
  },
  {
    threadId: 'worker-bravo-flaky-upload',
    name: 'Bravo',
    repository: 'acme/api',
    topic: 'Make the upload test stop failing one run in ten',
    phase: 'waiting',
    spentUsd: 3.9,
    budgetUsd: 4,
    branch: 'bravo/flaky-upload',
    waits: ['approval'],
    startupMs: 38_000
  },
  {
    threadId: 'worker-charlie-docs-links',
    name: 'Charlie',
    repository: 'acme/docs',
    topic: 'Fix the dead links of the API reference',
    phase: 'setup',
    spentUsd: 0,
    waits: [],
    sandbox: {
      state: 'setup',
      step: 'clone',
      elapsedMs: 12_000
    }
  },
  {
    threadId: 'worker-foxtrot-readme',
    name: 'Foxtrot',
    repository: 'acme/docs',
    topic: 'Fix the typos of the package READMEs',
    lastActiveAt: agoInMs(ASLEEP_AGE),
    phase: 'idle',
    spentUsd: 0.3,
    budgetUsd: 5,
    waits: []
  },
  {
    threadId: 'worker-golf-node-version',
    name: 'Golf',
    repository: 'acme/api',
    topic: 'Say which Node version the repository asks for',
    lastActiveAt: agoInMs(SANDBOX_FAILURE_AGE),
    phase: 'idle',
    spentUsd: 0.04,
    budgetUsd: 5,
    waits: [],
    sandboxFailure: {
      step: 'create',
      cause:
        'The image of the sandbox is missing: build it before the first sandbox.',
      failedAt: agoInMs(SANDBOX_FAILURE_AGE)
    }
  },
  {
    threadId: MERGED_FIXTURE_THREAD,
    name: 'Delta',
    repository: 'acme/web',
    topic: 'ENG-97',
    subject: 'ENG-97',
    phase: 'finished',
    spentUsd: 2.71,
    branch: 'delta/dark-mode',
    pullRequest: MERGED_FIXTURE_PULL_REQUEST,
    pullRequestRevision: 'revision-9',
    waits: [],
    outcome: { value: 'success', changedAt: agoInMs(MERGED_AGE) }
  },
  {
    threadId: 'worker-echo-cache-key',
    name: 'Echo',
    repository: 'acme/api',
    topic: 'Key the price cache on the currency',
    phase: 'finished',
    spentUsd: 4.02,
    branch: 'echo/cache-key',
    waits: [],
    outcome: {
      value: 'blocked',
      cause: 'The staging database refused the sandbox address.',
      changedAt: agoInMs(BLOCKED_AGE)
    }
  }
]

export const FIXTURE_FEEDBACK: FeedbackReport[] = [
  {
    id: 'feedback-1',
    at: agoAsText(FEEDBACK_AGE),
    kind: 'confusing',
    impact: 'worked_around',
    observed: 'git push origin main was refused with no reason.',
    expected: 'The refusal names the branch I can push to.',
    tool: 'bash',
    source: 'agent',
    harness: 'workcell/worker',
    agent: 'Bravo',
    model: 'fake',
    threadId: 'worker-bravo-flaky-upload',
    runId: 'run-1',
    version: '0.0.0'
  },
  {
    id: 'feedback-2',
    at: agoAsText(OLDER_FEEDBACK_AGE),
    kind: 'missing',
    impact: 'blocked',
    observed: 'No tool reads the logs of the staging deploy.',
    expected: 'A read-only tool that tails the deploy logs.',
    source: 'agent',
    harness: 'workcell/worker',
    agent: 'Echo',
    model: 'fake',
    threadId: 'worker-echo-cache-key',
    runId: 'run-2',
    version: '0.0.0'
  }
]

export const FIXTURE_DIFF = `diff --git a/src/auth/redirect.ts b/src/auth/redirect.ts
--- a/src/auth/redirect.ts
+++ b/src/auth/redirect.ts
@@ -1,3 +1,7 @@
-export const afterSignIn = () => {
-  return '/'
+export const afterSignIn = (requested: string | null) => {
+  if (requested === null || !requested.startsWith('/')) {
+    return '/'
+  }
+
+  return requested
 }
`

const READY_LABEL = { name: 'agent-ready', color: '#5e6ad2' }

const WEB_LABEL = { name: 'repo:web', color: '#26b5ce' }

const ticketUrl = (key: string) => {
  return `https://tracker.example.com/acme/issue/${key}`
}

export const FIXTURE_TRACKER = 'Linear'

const markOf = (path: string) => {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${path}"/></svg>`)}`
}

export const FIXTURE_TRACKER_MARK = {
  name: 'Linear',
  color: '#5E6AD2',
  iconUrl: markOf(
    'M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z'
  )
}

export const FIXTURE_CODE_HOST_MARK = {
  name: 'GitHub',
  iconUrl: markOf(
    'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12'
  )
}

export const FIXTURE_QUEUE: QueuedTicket[] = [
  {
    key: 'ENG-142',
    title: 'Keep the cart of a visitor who signs in halfway through checkout',
    url: ticketUrl('ENG-142'),
    state: { name: 'Todo', category: 'open' },
    labels: [READY_LABEL, WEB_LABEL, { name: 'Bug', color: '#eb5757' }],
    assignees: [{ name: 'Ada Lovelace' }],
    priority: 'Urgent'
  },
  {
    key: 'ENG-151',
    title: 'Rename the export button of the reports page',
    url: ticketUrl('ENG-151'),
    state: { name: 'Todo', category: 'open' },
    labels: [READY_LABEL],
    assignees: [],
    priority: 'High',
    blocker: 'It needs a repository label: repo:web, repo:api.'
  },
  {
    key: 'ENG-139',
    title: 'Show the delivery date on the order page',
    url: ticketUrl('ENG-139'),
    state: { name: 'Backlog', category: 'open' },
    labels: [READY_LABEL, { name: 'repo:api', color: '#f2994a' }],
    assignees: [{ name: 'Grace Hopper' }],
    priority: 'High'
  },
  {
    key: 'ENG-120',
    title:
      'Replace every hand-written date format of the dashboard, the invoices and the emails with the one formatter the design system ships',
    url: ticketUrl('ENG-120'),
    state: { name: 'Todo', category: 'open' },
    labels: [
      READY_LABEL,
      WEB_LABEL,
      { name: 'Tech debt', color: '#95a2b3' },
      { name: 'Design system', color: '#bb87fc' },
      { name: 'Invoices', color: '#4cb782' },
      { name: 'Emails', color: '#f7c8c1' }
    ],
    assignees: [],
    priority: 'Low'
  },
  {
    key: 'ENG-98',
    title: 'Drop the unused feature flags',
    url: ticketUrl('ENG-98'),
    state: { name: 'Backlog', category: 'open' },
    labels: [READY_LABEL, WEB_LABEL],
    assignees: []
  }
]

export const FIXTURE_TICKETS = new Map<string, TicketDetails>(
  Object.entries({
    'ENG-128': {
      key: 'ENG-128',
      title: 'Send a signed-out visitor back to the page they asked for',
      url: ticketUrl('ENG-128'),
      state: { name: 'In Progress', category: 'open', color: '#f2c94c' },
      labels: [READY_LABEL, WEB_LABEL, { name: 'Bug', color: '#eb5757' }],
      assignees: [{ name: 'Ada Lovelace' }],
      priority: 'High',
      description:
        'A visitor who opens a private page while signed out lands on the home page once signed in, and loses the page they asked for.\n\n## Done when\n\n* The sign-in page sends the visitor back to the page they asked for\n* A path that leaves the site sends the visitor home instead\n* The auth tests cover both'
    },
    'ENG-97': {
      key: 'ENG-97',
      title: 'Follow the system colour scheme on the settings page',
      url: ticketUrl('ENG-97'),
      state: { name: 'Done', category: 'closed', color: '#5e6ad2' },
      labels: [WEB_LABEL],
      assignees: [{ name: 'Grace Hopper' }],
      description: ''
    }
  })
)

const PULL_REQUEST_AGE = Temporal.Duration.from({ minutes: 50 })

export const FIXTURE_PULL_REQUESTS = new Map<string, PullRequestDetails>(
  Object.entries({
    [LIVE_FIXTURE_PULL_REQUEST]: {
      key: '#418',
      title:
        'fix(auth): send a signed-out visitor back to the page they asked for',
      url: LIVE_FIXTURE_PULL_REQUEST,
      description:
        'The sign-in page kept no trace of the page a visitor asked for.\n\n- `afterSignIn` takes the requested path, and refuses one that leaves the site\n- The auth tests cover both\n\nCloses ENG-128',
      state: 'open',
      author: { name: 'alpha-bot' },
      assignees: [{ name: 'alpha-bot' }],
      labels: [{ name: 'bug', color: '#d73a4a' }],
      reviewers: [
        { name: 'Ada Lovelace', state: 'changes-requested' },
        { name: 'web-team', state: 'requested' }
      ],
      base: 'main',
      head: 'alpha/login-redirect',
      headCommit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      commitCount: 3,
      commentCount: 2,
      updatedAt: agoAsText(FEEDBACK_AGE),
      isInMergeQueue: false,
      mergeStatus: 'blocked',
      additions: 6,
      deletions: 2,
      checks: [
        {
          name: 'Lint',
          state: 'success',
          url: 'https://github.com/acme/web/actions/runs/1/job/1'
        },
        {
          name: 'Typecheck',
          state: 'success',
          url: 'https://github.com/acme/web/actions/runs/1/job/2'
        },
        {
          name: 'Unit tests',
          state: 'pending',
          url: 'https://github.com/acme/web/actions/runs/1/job/3'
        },
        {
          name: 'deploy/preview',
          state: 'failure',
          url: 'https://preview.example.com/418',
          description: 'The preview build ran out of memory'
        }
      ],
      hiddenChecks: 2,
      files: [
        {
          path: 'src/auth/redirect.ts',
          status: 'modified',
          additions: 6,
          deletions: 2
        }
      ],
      fileCount: 1
    },
    [MERGED_FIXTURE_PULL_REQUEST]: {
      key: '#412',
      title: 'feat(settings): follow the system colour scheme',
      url: MERGED_FIXTURE_PULL_REQUEST,
      description: '',
      state: 'merged',
      author: { name: 'delta-bot' },
      assignees: [],
      labels: [],
      reviewers: [{ name: 'Grace Hopper', state: 'approved' }],
      base: 'main',
      head: 'delta/dark-mode',
      headCommit: 'b2c3d4e5f60718293a4b5c6d7e8f901234567890',
      commitCount: 5,
      commentCount: 0,
      updatedAt: agoAsText(PULL_REQUEST_AGE),
      isInMergeQueue: false,
      additions: 41,
      deletions: 12,
      checks: [
        {
          name: 'Lint',
          state: 'success',
          url: 'https://github.com/acme/web/actions/runs/2/job/1'
        },
        {
          name: 'Unit tests',
          state: 'success',
          url: 'https://github.com/acme/web/actions/runs/2/job/2'
        }
      ],
      hiddenChecks: 0,
      files: [
        {
          path: 'src/settings/colour-scheme.ts',
          status: 'added',
          additions: 30,
          deletions: 0
        },
        {
          path: 'src/settings/settings-page.tsx',
          status: 'modified',
          additions: 11,
          deletions: 12
        }
      ],
      fileCount: 2,
      merge: {
        mergedAt: agoAsText(PULL_REQUEST_AGE),
        mergedBy: { name: 'delta-bot' },
        commit: 'c0ffee1234567890c0ffee1234567890c0ffee12'
      }
    }
  })
)
