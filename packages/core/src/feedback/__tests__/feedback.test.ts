import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarnessHost, logIdOf } from '@tanstack/ai-harness'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { fakeText, type FakeResponseStep } from '@tanstack/ai/testing'
import {
  FEEDBACK_PLUGIN,
  type FeedbackOptions,
  type FeedbackReport
} from '#/feedback/feedback.ts'
import type { WorkerMetadata } from '#/session/metadata.ts'
import { createHostFreeSandbox } from '#/testing/host-free-sandbox.ts'
import { SILENT_HOST_LOGGER, TEST_STARTER } from '#/testing/test-doubles.ts'
import { defineTestWorker } from '#/testing/tool-call.ts'

const WORKER_THREAD = 'worker-feedback'

const FEEDBACK_TOOL = 'send_feedback'

const SHORT_DELIVERY_TIMEOUT_MS = 50

const DENIED_PUSH_REPORT = {
  kind: 'confusing',
  impact: 'worked_around',
  observed: 'git push origin main was refused with no reason.',
  expected: 'The refusal names the branch I can push to.',
  tool: 'bash',
  source: 'agent'
}

type Warning = { message: string; meta: unknown }

let hostFree: Awaited<ReturnType<typeof createHostFreeSandbox>>

function sendFeedback(input: Record<string, unknown>): FakeResponseStep {
  return { toolCalls: [{ name: FEEDBACK_TOOL, input }] }
}

async function runWorker(
  responses: FakeResponseStep[],
  {
    feedback,
    mode = 'acceptEdits',
    metadata
  }: {
    feedback?: FeedbackOptions
    mode?: string
    metadata?: WorkerMetadata & Record<string, unknown>
  } = {}
) {
  const persistence = memoryPersistence()
  const model = fakeText()
  const toolResults: string[] = []
  const warnings: Warning[] = []
  model.setResponses([...responses, { text: 'Done.' }])
  const host = createHarnessHost({
    persistence,
    logger: {
      ...SILENT_HOST_LOGGER,
      warn: (message, meta) => {
        warnings.push({ message, meta })
      }
    }
  })
  const worker = defineTestWorker({ host, model, hostFree, feedback })
  const session = await host.open(worker, {
    threadId: WORKER_THREAD,
    user: TEST_STARTER
  })
  await session.setPluginSetting({ key: 'mode', value: mode })

  if (metadata !== undefined) {
    await session.updateIndexEntry({ metadata })
  }

  const stopListening = session.onEvent('TOOL_CALL_RESULT', ({ event }) => {
    toolResults.push(JSON.stringify(event.content))
  })

  await session.send('Push the fix.')
  stopListening()
  const { status, plugins } = session.snapshot()
  await host.close()

  const entries = await persistence.stores.log.read({
    logId: logIdOf({ logId: WORKER_THREAD })
  })
  const reports = entries.flatMap(({ record }) => {
    return record.type === 'workcell.feedback' ? [record] : []
  })

  return {
    model: model.model,
    toolResults,
    warnings,
    reports,
    status,
    pluginState: plugins[FEEDBACK_PLUGIN]
  }
}

describe('the feedback of a worker', () => {
  beforeAll(async () => {
    hostFree = await createHostFreeSandbox({})
  })

  afterAll(async () => {
    await hostFree.destroy()
  })

  it('lands a report in the session log after a refusal of the deny guard, in bypass mode', async () => {
    const run = await runWorker(
      [
        {
          toolCalls: [
            { name: 'bash', input: { command: 'git push origin main' } }
          ]
        },
        sendFeedback(DENIED_PUSH_REPORT)
      ],
      { mode: 'bypass' }
    )

    expect(run.toolResults[0]).toContain(FEEDBACK_TOOL)
    expect(run.reports).toStrictEqual([
      expect.objectContaining({
        ...DENIED_PUSH_REPORT,
        harness: 'workcell/worker',
        model: run.model,
        threadId: WORKER_THREAD,
        reporter: TEST_STARTER.id
      })
    ])
  })

  it('keeps each report in the plugin state, where a reader of the session finds it', async () => {
    const run = await runWorker([sendFeedback(DENIED_PUSH_REPORT)])

    expect(run.pluginState).toStrictEqual({
      reports: [expect.objectContaining(DENIED_PUSH_REPORT)]
    })
  })

  it('delivers the report with the facts the host knows', async () => {
    const delivered: FeedbackReport[] = []
    const run = await runWorker([sendFeedback(DENIED_PUSH_REPORT)], {
      feedback: {
        deliver: async (report) => {
          delivered.push(report)
        },
        threadLink: ({ metadata }) => {
          return `https://chat.example.com/threads/${String(metadata?.chatThreadId)}`
        }
      },
      metadata: {
        name: 'Alpha',
        task: 'Fix the login.',
        repository: 'acme/app',
        chatThreadId: 'chat-thread-12'
      }
    })

    expect(delivered).toStrictEqual(
      run.reports.map(({ type: _type, ...report }) => {
        return report
      })
    )
    const [report] = delivered

    expect(report).toMatchObject({
      agent: 'Alpha',
      task: 'Fix the login.',
      threadLink: 'https://chat.example.com/threads/chat-thread-12'
    })
    expect(report?.version).toMatch(/^\d+\.\d+\.\d+$/u)
    expect(report?.runId).toMatch(/\S/u)
    expect(report?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
  })

  it.each([
    [
      'fails',
      async () => {
        throw new Error('The webhook answered 503.')
      }
    ],
    [
      'hangs',
      async () => {
        await new Promise(() => {})
      }
    ]
  ])(
    'lets the turn go on when the delivery %s, with a warning in the log',
    async (_case, deliver) => {
      const run = await runWorker([sendFeedback(DENIED_PUSH_REPORT)], {
        feedback: { deliver, deliveryTimeoutMs: SHORT_DELIVERY_TIMEOUT_MS }
      })

      expect(run.status).toBe('idle')
      expect(run.toolResults).toStrictEqual([
        expect.stringContaining('not delivered: carry on with your task')
      ])
      expect(run.reports).toHaveLength(1)
      expect(
        run.warnings.map(({ message }) => {
          return message
        })
      ).toStrictEqual([expect.stringContaining('not delivered')])
    }
  )

  it.each(['', 'test', 'None', 'n/a', ' TODO. '])(
    'refuses a report whose text is the filler %j, in one line',
    async (filler) => {
      const run = await runWorker([
        sendFeedback({ ...DENIED_PUSH_REPORT, observed: filler })
      ])

      expect(run.reports).toStrictEqual([])
      expect(run.toolResults).toStrictEqual([
        expect.stringMatching(/filler text[^\n]*"\}"$/u)
      ])
    }
  )

  it('refuses a tool name that could mention a person or break a table', async () => {
    const run = await runWorker([
      sendFeedback({ ...DENIED_PUSH_REPORT, tool: '@maintainer | bash' })
    ])

    expect(run.reports).toStrictEqual([])
  })

  it('files no second report when the host restarts during the call', async () => {
    const persistence = memoryPersistence()
    const deliveries: string[] = []
    const deliveryStarts = Promise.withResolvers<null>()
    const firstModel = fakeText()
    firstModel.setResponses([sendFeedback(DENIED_PUSH_REPORT)])
    const nextModelMessages: string[] = []
    const nextModel = fakeText()
    nextModel.setResponses([
      ({ request }) => {
        nextModelMessages.push(JSON.stringify(request.messages))

        return { text: 'Done.' }
      }
    ])
    const inputId = 'report-cut-by-a-restart'
    const firstHost = createHarnessHost({
      persistence,
      logger: SILENT_HOST_LOGGER
    })
    const first = await firstHost.open(
      defineTestWorker({
        host: firstHost,
        model: firstModel,
        hostFree,
        feedback: {
          deliver: async (report) => {
            deliveries.push(report.id)
            deliveryStarts.resolve(null)
            await new Promise(() => {})
          }
        }
      }),
      { threadId: WORKER_THREAD, user: TEST_STARTER }
    )
    await first.send('Report the refused push.', { inputId }).receipt
    await deliveryStarts.promise
    await firstHost.close({ recoverable: true })

    const nextHost = createHarnessHost({
      persistence,
      logger: SILENT_HOST_LOGGER
    })

    try {
      const next = await nextHost.open(
        defineTestWorker({
          host: nextHost,
          model: nextModel,
          hostFree,
          feedback: {
            deliver: async (report) => {
              deliveries.push(report.id)
            }
          }
        }),
        { threadId: WORKER_THREAD, user: TEST_STARTER }
      )

      await expect(next.settled({ inputId })).resolves.toMatchObject({
        outcome: 'completed'
      })
      expect(deliveries).toHaveLength(1)
      expect(nextModelMessages.join('\n')).toContain(
        'A send_feedback report that a host restart cut is never sent again.'
      )
    } finally {
      await nextHost.close()
    }
  })
})
