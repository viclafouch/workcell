import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createHarnessHost } from '@tanstack/ai-harness'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { fakeText } from '@tanstack/ai/testing'
import {
  createHostFreeSandbox,
  defineTestWorker,
  SILENT_HOST_LOGGER,
  TEST_STARTER
} from '@workcell/core/testing'
import { testOctokit } from '#/api/__tests__/test-octokit.ts'
import { githubFeedbackIssues } from '#/feedback/feedback-issues.ts'

const GITHUB_TOKEN = 'github_pat_feedback_test_token'

const FEEDBACK_REPOSITORY = 'acme/agent-feedback'

const ISSUES_URL = `https://api.github.com/repos/${FEEDBACK_REPOSITORY}/issues`

const WORKER_THREAD = 'worker-feedback-issue'

const PROJECT_LABELS = [
  { name: 'agent-feedback', color: '0e8a16', description: 'Sent by an agent' },
  { name: 'project:shop', color: '5319e7' }
]

const LABELS_URL = `https://api.github.com/repos/${FEEDBACK_REPOSITORY}/labels`

const REPEATS_PAST_THE_TITLE_LIMIT = 5

const REFUSED_PUSH_REPORT = {
  kind: 'confusing',
  impact: 'worked_around',
  observed: 'git push origin main was refused. @maintainer please look.',
  expected: 'The refusal names the branch I can push to.',
  tool: 'bash',
  source: 'agent'
}

const issueBodySchema = z.object({
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string())
})

type IssueBody = z.infer<typeof issueBodySchema>

const labelBodySchema = z.object({
  name: z.string().optional(),
  color: z.string(),
  description: z.string().optional()
})

const openedIssues: IssueBody[] = []

const labelColors = new Map<string, string>()

const labelRequests: string[] = []

const issueHold = { isOn: false }

const network = setupServer(
  http.post(LABELS_URL, async ({ request }) => {
    const label = labelBodySchema.parse(await request.json())
    const name = label.name ?? ''
    labelRequests.push(`create ${name}`)

    if (labelColors.has(name)) {
      return HttpResponse.json(
        {
          message: 'Validation Failed',
          errors: [{ code: 'already_exists' }]
        },
        { status: 422 }
      )
    }

    labelColors.set(name, label.color)

    return HttpResponse.json({ name, color: label.color }, { status: 201 })
  }),
  http.patch(`${LABELS_URL}/:name`, async ({ request, params }) => {
    const name = z.string().parse(params.name)
    const label = labelBodySchema.parse(await request.json())
    labelRequests.push(`update ${name}`)
    labelColors.set(name, label.color)

    return HttpResponse.json({ name, color: label.color })
  }),
  http.post(ISSUES_URL, async ({ request }) => {
    if (request.headers.get('authorization') !== `token ${GITHUB_TOKEN}`) {
      return HttpResponse.json({ message: 'Bad credentials' }, { status: 401 })
    }

    openedIssues.push(issueBodySchema.parse(await request.json()))

    if (issueHold.isOn) {
      await new Promise(() => {})
    }

    return HttpResponse.json(
      { number: openedIssues.length, html_url: `${ISSUES_URL}/1` },
      { status: 201 }
    )
  })
)

let hostFree: Awaited<ReturnType<typeof createHostFreeSandbox>>

function feedbackIssues() {
  return githubFeedbackIssues({
    octokit: testOctokit(GITHUB_TOKEN),
    repository: FEEDBACK_REPOSITORY,
    labels: PROJECT_LABELS
  })
}

function workerOn(
  persistence: ReturnType<typeof memoryPersistence>,
  model: ReturnType<typeof fakeText>,
  deliver = feedbackIssues()
) {
  const host = createHarnessHost({ persistence, logger: SILENT_HOST_LOGGER })
  const worker = defineTestWorker({
    host,
    model,
    hostFree,
    feedback: { deliver }
  })

  return { host, worker }
}

async function reportTheRefusedPush(
  overrides: Record<string, string> = {},
  deliver = feedbackIssues()
) {
  const model = fakeText()
  model.setResponses([
    {
      toolCalls: [
        {
          name: 'send_feedback',
          input: { ...REFUSED_PUSH_REPORT, ...overrides }
        }
      ]
    },
    { text: 'Done.' }
  ])
  const { host, worker } = workerOn(memoryPersistence(), model, deliver)
  const session = await host.open(worker, {
    threadId: WORKER_THREAD,
    user: TEST_STARTER
  })

  await session.send('Push the fix.')
  await host.close()
}

describe('the feedback issues of GitHub', () => {
  beforeAll(async () => {
    network.listen({ onUnhandledFrame: 'error' })
    hostFree = await createHostFreeSandbox({})
  })

  beforeEach(() => {
    openedIssues.length = 0
    labelColors.clear()
    labelRequests.length = 0
    issueHold.isOn = false
  })

  afterAll(async () => {
    network.close()
    await hostFree.destroy()
  })

  it('opens one issue labelled with the labels of the project, the kind, the impact and the tool', async () => {
    await reportTheRefusedPush()
    const [issue] = openedIssues

    expect(openedIssues).toHaveLength(1)
    expect(issue?.title).toContain('git push origin main was refused')
    expect(issue?.body).toContain(REFUSED_PUSH_REPORT.expected)
    expect(issue?.labels).toStrictEqual([
      'agent-feedback',
      'project:shop',
      'kind:confusing',
      'impact:worked_around',
      'tool:bash'
    ])
  })

  it('colours each label of the report, and recolours a label that already exists', async () => {
    labelColors.set('kind:confusing', 'ededed')

    await reportTheRefusedPush()

    expect(Object.fromEntries(labelColors)).toStrictEqual({
      'agent-feedback': '0e8a16',
      'project:shop': '5319e7',
      'kind:confusing': 'fbca04',
      'impact:worked_around': 'd93f0b',
      'tool:bash': 'c5def5'
    })
  })

  it('colours a label once for each destination', async () => {
    const deliver = feedbackIssues()
    await reportTheRefusedPush({}, deliver)
    const requestsOfTheFirstReport = [...labelRequests]
    await reportTheRefusedPush({}, deliver)

    expect(openedIssues).toHaveLength(2)
    expect(labelRequests).toStrictEqual(requestsOfTheFirstReport)
  })

  it('opens with who reported and how much it hurt, then the text of the agent as plain text', async () => {
    await reportTheRefusedPush()
    const [issue] = openedIssues

    expect(issue?.title).toBe(
      '🤔 git push origin main was refused. maintainer please look.'
    )
    expect(issue?.body).toMatch(/^> \[!WARNING\]\n/u)
    expect(issue?.body).not.toContain('```')
    expect(issue?.body).toContain('`@maintainer` please look')
  })

  it('shows a markdown trick of the agent as plain text', async () => {
    await reportTheRefusedPush({
      observed:
        'See ![x](https://tracker.example.com/pixel.png) and <img src=x> in #34.'
    })
    const [issue] = openedIssues

    expect(issue?.body).toContain(
      'See \\!\\[x\\]\\(https://tracker.example.com/pixel.png\\) and \\<img src=x\\> in `#34`.'
    )
  })

  it('cuts a long title at a word, with an ellipsis', async () => {
    await reportTheRefusedPush({
      observed: `${'git push origin main was refused '.repeat(REPEATS_PAST_THE_TITLE_LIMIT)}again.`
    })
    const [issue] = openedIssues

    expect(issue?.title).toBe(
      '🤔 git push origin main was refused git push origin main was refused git push origin main was…'
    )
  })

  it('opens no second issue when the host restarts during the call', async () => {
    issueHold.isOn = true
    const persistence = memoryPersistence()
    const inputId = 'feedback-issue-cut-by-a-restart'
    const firstModel = fakeText()
    firstModel.setResponses([
      { toolCalls: [{ name: 'send_feedback', input: REFUSED_PUSH_REPORT }] }
    ])
    const first = workerOn(persistence, firstModel)
    const firstSession = await first.host.open(first.worker, {
      threadId: WORKER_THREAD,
      user: TEST_STARTER
    })
    await firstSession.send('Report the refused push.', { inputId }).receipt
    await expect
      .poll(() => {
        return openedIssues.length
      })
      .toBe(1)
    await first.host.close({ recoverable: true })
    issueHold.isOn = false

    const nextModel = fakeText()
    nextModel.setResponses([{ text: 'Done.' }])
    const next = workerOn(persistence, nextModel)

    try {
      const nextSession = await next.host.open(next.worker, {
        threadId: WORKER_THREAD,
        user: TEST_STARTER
      })

      await expect(nextSession.settled({ inputId })).resolves.toMatchObject({
        outcome: 'completed'
      })
      expect(openedIssues).toHaveLength(1)
    } finally {
      await next.host.close()
    }
  })
})
