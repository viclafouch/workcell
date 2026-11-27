import type { FeedbackReport, QueuedTicket, WorkerView } from '@workcell/core'

export const LIVE_FIXTURE_THREAD = 'worker-alpha-login-redirect'

export const BOT_FIXTURE_THREAD = 'bot-standup'

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

export const FIXTURE_WORKERS: WorkerView[] = [
  {
    threadId: LIVE_FIXTURE_THREAD,
    name: 'Alpha',
    repository: 'acme/web',
    topic: 'Send a signed-out visitor back to the page they asked for',
    originThreadId: BOT_FIXTURE_THREAD,
    lastActiveAt: agoInMs(FEEDBACK_AGE),
    phase: 'tool',
    command: 'pnpm vitest run src/auth',
    turnUsd: 0.18,
    spentUsd: 1.42,
    budgetUsd: 5,
    branch: 'alpha/login-redirect',
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
    threadId: 'worker-delta-dark-mode',
    name: 'Delta',
    repository: 'acme/web',
    topic: 'Follow the system colour scheme on the settings page',
    phase: 'finished',
    spentUsd: 2.71,
    branch: 'delta/dark-mode',
    pullRequest: 'https://github.com/acme/web/pull/412',
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
