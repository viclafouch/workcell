import type {
  PullRequestCheck,
  PullRequestDetails,
  TicketDetails,
  WorkerView
} from '@workcell/core'

export const FIXTURE_DATASETS = ['demo', 'worst', 'empty', 'one'] as const

export type FixtureDataset = (typeof FIXTURE_DATASETS)[number]

export const FIXTURE_DATASET_COOKIE = 'workcell-fixture-dataset'

export type FixtureData = {
  workers: WorkerView[]
  tickets: Map<string, TicketDetails>
  pullRequests: Map<string, PullRequestDetails>
}

const WORST_TICKET_KEY = 'PLATFORM-128734'

const WORST_PULL_REQUEST =
  'https://github.com/northwind-industries-holdings/storefront-checkout-experience-platform/pull/128734'

const WORST_REPOSITORY =
  'northwind-industries-holdings/storefront-checkout-experience-platform'

const WORST_HEAD =
  'aleksandra/PLATFORM-128734-keep-cart-coupon-and-delivery-slot-through-sign-in-sso-and-two-factor-on-every-storefront'

const WORST_BASE = 'release/2026-11-27-hotfix-checkout-coupon-rollback-eu-uk-us'

const WORST_MERGED_PULL_REQUEST =
  'https://github.com/northwind-industries-holdings/storefront-checkout-experience-platform/pull/9'

const BROKEN_AVATAR = 'https://avatars.example.com/does-not-exist.png'

const SHARDS = 36

const FAILING_EVERY = 9

const RUNNING_EVERY = 5

const RENAMED_EVERY = 3

const LAST_YEAR_DAYS = 400

const MERGED_DAYS_AGO = 330

const HOURS_PER_DAY = 24

const daysAgo = (days: number) => {
  return Temporal.Now.instant()
    .subtract({ hours: days * HOURS_PER_DAY })
    .toString()
}

const WORST_LABELS = [
  { name: 'customer-feedback-from-enterprise-onboarding', color: '#d73a4a' },
  { name: 'Benachrichtigungseinstellungen', color: '#0e8a16' },
  { name: 'frontend', color: '#1d76db' },
  { name: 'q3', color: '#fbca04' },
  { name: 'urgent', color: '#b60205' },
  { name: 'needs-review', color: '#5319e7' },
  { name: 'a11y', color: '#c2e0c6' },
  { name: 'Paramètres de confidentialité et de sécurité', color: '#bfd4f2' },
  { name: 'checkout', color: '#006b75' },
  { name: 'eu', color: '#e4e669' },
  { name: 'sso', color: '#d4c5f9' },
  { name: '🦊 fox-team', color: '#f9d0c4' }
]

const WORST_DESCRIPTION = [
  'A visitor who opens `https://shop.example.com/checkout/basket/9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f?coupon=SPRING-SALE-2026-EU-UK-US&slot=2026-12-24T18:30:00%2B01:00` while signed out loses the cart, the coupon and the delivery slot once signed in through SSO and the two-factor step.',
  '',
  '## Done when',
  '',
  '* The cart, the coupon and the delivery slot survive sign-in, SSO and the two-factor step on every storefront: EU, UK and US',
  '* `bartholomew.fitzgerald@northwind-industries-holdings.example.com` gets the confirmation email in his language',
  '* `<script>alert(1)</script>` and `&amp;` in a coupon name render as text',
  '',
  '```ts',
  'export const keepCheckoutThroughSignIn = async ({ basketId, couponCode, deliverySlot, storefront, signInMethod }: KeepCheckoutThroughSignInParams): Promise<KeptCheckout> => { return checkout.restore({ basketId, couponCode, deliverySlot, storefront, signInMethod }) }',
  '```',
  '',
  'Paramètres de confidentialité et de sécurité, Benachrichtigungseinstellungen, 王秀英, Đặng Thị Ngọc Hân, نور الهدى عبد الرحمن.'
].join('\n')

const checkStateOf = (index: number): PullRequestCheck['state'] => {
  if (index % FAILING_EVERY === 0) {
    return 'failure'
  }

  return index % RUNNING_EVERY === 0 ? 'pending' : 'success'
}

const worstChecks = (): PullRequestCheck[] => {
  const shards = Array.from(
    { length: SHARDS },
    (_, index): PullRequestCheck => {
      return {
        name: `e2e (ubuntu-latest, node 26, shard ${index + 1} of ${SHARDS}, playwright-webkit-mobile-safari-iphone-15-pro-max)`,
        state: checkStateOf(index),
        url: `https://github.com/northwind-industries-holdings/storefront-checkout-experience-platform/actions/runs/1/job/${index}`
      }
    }
  )

  return [
    {
      name: 'deploy/preview-storefront-checkout-experience-platform-eu-west-1',
      state: 'failure',
      url: 'https://preview.example.com/128734',
      description:
        'The preview build ran out of memory after 41 minutes while bundling the storefront, the checkout and the account areas for every locale'
    },
    { name: 'J', state: 'cancelled' },
    ...shards
  ]
}

const WORST_TICKET: TicketDetails = {
  key: WORST_TICKET_KEY,
  title:
    'Keep the cart, the coupon and the delivery slot of a signed-out visitor through sign-in, SSO and the two-factor step on every storefront (EU, UK, US): follow-up of PLATFORM-128512',
  url: `https://tracker.example.com/northwind/issue/${WORST_TICKET_KEY}/keep-the-cart-the-coupon-and-the-delivery-slot-of-a-signed-out-visitor`,
  state: {
    name: 'Waiting for design review (blocked by legal)',
    category: 'open',
    color: '#f2994a'
  },
  labels: WORST_LABELS,
  assignees: [
    { name: 'Aleksandra Wiśniewska-Kowalczyk', avatarUrl: BROKEN_AVATAR },
    { name: 'Jo' },
    { name: 'نور الهدى عبد الرحمن' }
  ],
  priority: 'Urgent',
  description: WORST_DESCRIPTION
}

const WORST_OPEN_PULL_REQUEST: PullRequestDetails = {
  key: '#128734',
  title:
    'feat(checkout): keep the cart, the coupon and the delivery slot of a signed-out visitor through sign-in, SSO and the two-factor step on every storefront: `keepCheckoutThroughSignInSsoAndTwoFactorOnEveryStorefront` (PLATFORM-128734)',
  url: WORST_PULL_REQUEST,
  description: WORST_DESCRIPTION,
  state: 'open',
  author: {
    name: 'thisisaverylongusernamethatisallowed39',
    avatarUrl: BROKEN_AVATAR
  },
  assignees: [
    { name: 'Aleksandra Wiśniewska-Kowalczyk', avatarUrl: BROKEN_AVATAR },
    { name: 'J' }
  ],
  labels: WORST_LABELS,
  reviewers: [
    {
      name: 'Christopher Alexander Montgomery III',
      state: 'changes-requested'
    },
    {
      name: 'frontend-platform-reviewers-europe-middle-east-africa',
      state: 'requested'
    },
    { name: 'Jo', state: 'approved' },
    { name: '👩🏽‍💻 Priya', state: 'commented' },
    { name: 'Seán O’Brien-Ó Súilleabháin', state: 'approved' },
    { name: 'dana', state: 'requested' }
  ],
  base: WORST_BASE,
  head: WORST_HEAD,
  headCommit: '9f8e7d6c5b4a4c3d8e2f1a0b9c8d7e6f01234567',
  commitCount: 1284,
  commentCount: 1284,
  updatedAt: daysAgo(LAST_YEAR_DAYS),
  isInMergeQueue: false,
  mergeStatus: 'conflicts',
  additions: 128_734,
  deletions: 1_000_000,
  checks: worstChecks(),
  hiddenChecks: 1284,
  files: Array.from({ length: 100 }, (_, index) => {
    return {
      path: `apps/storefront-checkout-experience-platform/src/features/checkout/keep-checkout-through-sign-in/sso-and-two-factor/__tests__/keep-checkout-through-sign-in-sso-and-two-factor-on-every-storefront.${index}.test.tsx`,
      status: index % RENAMED_EVERY === 0 ? 'renamed' : 'modified',
      additions: 12_873,
      deletions: index
    }
  }),
  fileCount: 1284
}

const WORST_MERGED: PullRequestDetails = {
  ...WORST_OPEN_PULL_REQUEST,
  key: '#9',
  url: WORST_MERGED_PULL_REQUEST,
  title: 'J',
  description: '',
  state: 'merged',
  assignees: [],
  labels: [],
  reviewers: [],
  commitCount: 1,
  commentCount: 0,
  mergeStatus: undefined,
  checks: [],
  hiddenChecks: 0,
  files: [],
  fileCount: 0,
  additions: 0,
  deletions: 0,
  merge: {
    mergedAt: daysAgo(MERGED_DAYS_AGO),
    mergedBy: { name: 'Konstantin Oberhauser-Wettstein' },
    commit: '0000000000000000000000000000000000000000'
  }
}

const EMPTY_PULL_REQUEST: PullRequestDetails = {
  ...WORST_OPEN_PULL_REQUEST,
  key: '#1',
  url: 'https://github.com/a/b/pull/1',
  title: 'Untitled',
  description: '',
  author: undefined,
  assignees: [],
  labels: [],
  reviewers: [],
  base: 'main',
  head: 'a',
  commitCount: 0,
  commentCount: 0,
  updatedAt: Temporal.Now.instant().toString(),
  mergeStatus: 'unknown',
  additions: 0,
  deletions: 0,
  checks: [],
  hiddenChecks: 0,
  files: [],
  fileCount: 0
}

const ONE_PULL_REQUEST: PullRequestDetails = {
  ...EMPTY_PULL_REQUEST,
  key: '#2',
  url: 'https://github.com/a/b/pull/2',
  title: 'Fix a typo',
  author: { name: 'J' },
  assignees: [{ name: 'J' }],
  labels: [{ name: 'docs', color: '#0075ca' }],
  reviewers: [{ name: 'Jo', state: 'approved' }],
  commitCount: 1,
  commentCount: 1,
  mergeStatus: 'ready',
  additions: 1,
  deletions: 1,
  checks: [{ name: 'lint', state: 'success' }],
  files: [
    { path: 'README.md', status: 'modified', additions: 1, deletions: 1 }
  ],
  fileCount: 1
}

const EMPTY_TICKET: TicketDetails = {
  key: 'A-1',
  title: 'Untitled',
  url: 'https://tracker.example.com/a/issue/A-1',
  state: { name: 'Todo', category: 'open' },
  labels: [],
  assignees: [],
  description: ''
}

const ONE_TICKET: TicketDetails = {
  ...EMPTY_TICKET,
  key: 'A-2',
  title: 'Fix a typo',
  labels: [{ name: 'docs', color: '#0075ca' }],
  assignees: [{ name: 'J' }],
  priority: 'Low',
  description: 'One line.'
}

type DatasetParams = {
  demo: FixtureData
  liveThread: string
  mergedThread: string
}

const withWork = (
  workers: readonly WorkerView[],
  threadId: string,
  work: Partial<WorkerView>
) => {
  return workers.map((worker) => {
    return worker.threadId === threadId ? { ...worker, ...work } : worker
  })
}

const datasetWith = (
  { demo, liveThread, mergedThread }: DatasetParams,
  live: { ticket: TicketDetails; pullRequest: PullRequestDetails },
  merged: PullRequestDetails
): FixtureData => {
  const liveWork = {
    subject: live.ticket.key,
    topic: live.ticket.key,
    pullRequest: live.pullRequest.url,
    repository:
      live.pullRequest === WORST_OPEN_PULL_REQUEST ? WORST_REPOSITORY : 'a/b',
    branch: live.pullRequest.head
  }
  const workers = withWork(
    withWork(demo.workers, liveThread, liveWork),
    mergedThread,
    { pullRequest: merged.url, subject: undefined, topic: 'J' }
  )

  return {
    workers,
    tickets: new Map([[live.ticket.key, live.ticket]]),
    pullRequests: new Map([
      [live.pullRequest.url, live.pullRequest],
      [merged.url, merged]
    ])
  }
}

export const fixtureDataOf = (
  dataset: FixtureDataset,
  params: DatasetParams
): FixtureData => {
  switch (dataset) {
    case 'demo': {
      return params.demo
    }
    case 'worst': {
      return datasetWith(
        params,
        { ticket: WORST_TICKET, pullRequest: WORST_OPEN_PULL_REQUEST },
        WORST_MERGED
      )
    }
    case 'empty': {
      return datasetWith(
        params,
        { ticket: EMPTY_TICKET, pullRequest: EMPTY_PULL_REQUEST },
        {
          ...EMPTY_PULL_REQUEST,
          key: '#3',
          url: 'https://github.com/a/b/pull/3'
        }
      )
    }
    case 'one': {
      return datasetWith(
        params,
        { ticket: ONE_TICKET, pullRequest: ONE_PULL_REQUEST },
        { ...ONE_PULL_REQUEST, key: '#4', url: 'https://github.com/a/b/pull/4' }
      )
    }
  }
}

export const matchIsFixtureDataset = (
  value: unknown
): value is FixtureDataset => {
  return FIXTURE_DATASETS.some((dataset) => {
    return dataset === value
  })
}
