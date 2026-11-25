import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { definePlugin } from '@tanstack/ai-harness'
import { fakeText } from '@tanstack/ai/testing'
import { EntrySkillLimits } from '#/budget/limits.ts'
import { createModelPricing } from '#/budget/pricing.ts'
import { createMigratedDatabase } from '#/testing/test-database.ts'
import { TEST_STARTER } from '#/testing/test-doubles.ts'
import {
  bash,
  BilledFailureFake,
  CHECK_THE_WORK,
  createOrigin,
  finishTask,
  ENTRY_SKILL,
  loggedLines,
  PROVIDER_COST_USD,
  ProviderCostFake,
  recordSpans,
  REPOSITORY,
  RESTORED_WORK,
  SANDBOX_SECRETS,
  spanCost,
  spanNamed,
  spanTokens,
  SPENT_AFTER_ONE_CALL,
  SPENT_AFTER_TWO_CALLS,
  TICKET_START,
  TOKENS_PER_PRICE_UNIT,
  toolResults,
  WORK_ON_A_BRANCH
} from './worker-fixtures.ts'
import {
  closeWorkerTestbed,
  liveSandboxKeys,
  openWorkers,
  openWorkerTestbed,
  outcomeOf,
  runWorkerThenStop,
  testbedHostFree,
  waitForArchive
} from './worker-testbed.ts'

describe('the budget of a worker', () => {
  beforeAll(async () => {
    await openWorkerTestbed({ hasEntrySkill: true })
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('takes the limits that a plugin gives its entry skill', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      [bash('git init --quiet'), { text: 'Done.' }],
      {
        plugins: [
          definePlugin({
            name: 'test/entry-skill-limits',
            setup: () => {
              return {
                contribute: [
                  EntrySkillLimits.item({
                    entrySkill: ENTRY_SKILL,
                    limits: SPENT_AFTER_ONE_CALL
                  })
                ]
              }
            }
          })
        ]
      }
    )

    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'TASK-7',
      entrySkill: ENTRY_SKILL
    })
    await worker.firstTurn
    const view = await agent.host.observe(agent.harness, {
      threadId: worker.threadId
    })

    expect(agent.model.state.callCount).toBe(1)
    await expect(view.snapshot()).resolves.toMatchObject({
      pendingWaits: [{ kind: 'human', turn: true }]
    })
  })

  it('stops before its next model call at its budget, asks, and goes on after a yes with a new budget', async () => {
    const url = await createMigratedDatabase()
    const answeredMessages: string[] = []
    await using agent = await openWorkers(
      url,
      [
        bash('git init --quiet'),
        ({ request }) => {
          answeredMessages.push(JSON.stringify(request.messages))

          return { text: 'Done.' }
        }
      ],
      { limits: SPENT_AFTER_ONE_CALL }
    )
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Start a repository.'
    })
    await worker.firstTurn
    const session = await agent.host.open(agent.harness, {
      user: TEST_STARTER,
      threadId: worker.threadId
    })
    const { pendingWaits } = session.snapshot()

    expect(agent.model.state.callCount).toBe(1)
    expect(pendingWaits).toMatchObject([{ kind: 'human', turn: true }])
    expect(pendingWaits[0]?.message).toContain('Alpha used its budget')

    const inputId = 'go-on-with-a-new-budget'
    await session.resolve({
      inputId,
      resume: pendingWaits.map(({ waitId }) => {
        return { interruptId: waitId, status: 'resolved', payload: 'yes' }
      })
    })
    await session.settled({ inputId })

    expect(answeredMessages.join('\n')).toContain('exit code: 0')
    expect(session.snapshot().pendingWaits).toStrictEqual([])
  })

  it('counts the spend of its task across a host restart', async () => {
    const url = await createMigratedDatabase()
    const { threadId } = await runWorkerThenStop(url, [{ text: 'On it.' }], {
      repository: REPOSITORY,
      task: 'Fix the login.'
    })

    await using restarted = await openWorkers(url, [{ text: 'Done.' }], {
      limits: SPENT_AFTER_ONE_CALL
    })
    await using session = await restarted.host.open(restarted.harness, {
      user: TEST_STARTER,
      threadId
    })
    await session.send('Go on.')

    const { pendingWaits } = session.snapshot()

    expect(restarted.model.state.callCount).toBe(0)
    expect(pendingWaits).toMatchObject([{ kind: 'human' }])
    expect(pendingWaits[0]?.message).toContain('used its budget')
  })

  it('counts the usage of a failed model call in its budget', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      [{ error: 'The response was cut off.' }, { text: 'Done.' }],
      {
        limits: SPENT_AFTER_ONE_CALL,
        model: new BilledFailureFake('fake-model', {})
      }
    )
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Fix the login.'
    })
    await worker.firstTurn
    await using session = await agent.host.open(agent.harness, {
      user: TEST_STARTER,
      threadId: worker.threadId
    })
    await session.send('Go on.')

    const { pendingWaits } = session.snapshot()

    expect(agent.model.state.callCount).toBe(1)
    expect(pendingWaits).toMatchObject([{ kind: 'human' }])
    expect(pendingWaits[0]?.message).toContain('Alpha used its budget')
  })

  it('refuses to open before it touches a sandbox when a model has no price', async () => {
    const url = await createMigratedDatabase()
    await testbedHostFree().provider.create({
      id: 'sandbox-before-the-price-check'
    })

    await expect(
      openWorkers(url, [], { pricing: createModelPricing({}) })
    ).rejects.toThrow('The model fake-model has no price')
    await expect(liveSandboxKeys()).resolves.toContain(
      'sandbox-before-the-price-check'
    )
  })

  it('fails its turn, with no model call, when a model of its log has no price', async () => {
    const url = await createMigratedDatabase()
    const { threadId } = await runWorkerThenStop(url, [{ text: 'On it.' }], {
      repository: REPOSITORY,
      task: 'Fix the login.'
    })

    await using restarted = await openWorkers(url, [{ text: 'Done.' }], {
      model: fakeText({ model: 'next-model' }),
      pricing: createModelPricing({ 'next-model': { input: 1, output: 1 } })
    })
    await using session = await restarted.host.open(restarted.harness, {
      user: TEST_STARTER,
      threadId
    })
    await expect(session.send('Go on.')).rejects.toThrow(
      'The model fake-model has no price'
    )
    expect(restarted.model.state.callCount).toBe(0)
  })

  it('lists the spend that the usage plugin saved in the session index', async () => {
    const url = await createMigratedDatabase()
    await runWorkerThenStop(url, [{ text: 'On it.' }], {
      repository: REPOSITORY,
      task: 'Fix the login.'
    })

    await using restarted = await openWorkers(url, [])
    const [listed] = await restarted.workers.listWorkers()

    expect(listed?.usage?.cost).toBeGreaterThan(0)
  })
})

describe('a worker stopped at its budget', () => {
  let origin: Awaited<ReturnType<typeof createOrigin>>

  beforeAll(async () => {
    await openWorkerTestbed()
  })

  beforeEach(async () => {
    origin = await createOrigin()

    return async () => {
      await origin.destroy()
    }
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('saves the changes of a turn that stops at its budget, and finds them on an answer after a host restart', async () => {
    const url = await createMigratedDatabase()
    const threadId = await (async () => {
      await using agent = await openWorkers(
        url,
        [{ text: 'On it.' }, bash(WORK_ON_A_BRANCH)],
        { originUrl: origin.url, limits: SPENT_AFTER_TWO_CALLS }
      )
      const worker = await agent.workers.startWorker({
        repository: REPOSITORY,
        starter: TEST_STARTER,
        task: 'Work on a branch.'
      })
      await worker.firstTurn
      await using session = await agent.host.open(agent.harness, {
        user: TEST_STARTER,
        threadId: worker.threadId
      })
      await session.setPluginSetting({ key: 'mode', value: 'bypass' })
      await session.send('Change the files.')

      expect(session.snapshot().pendingWaits).toMatchObject([{ kind: 'human' }])

      return worker.threadId
    })()

    await using restarted = await openWorkers(
      url,
      [bash(CHECK_THE_WORK), { text: 'All there.' }],
      { originUrl: origin.url, idleSandboxMs: 0 }
    )
    await expect(liveSandboxKeys()).resolves.not.toContain(
      restarted.sandboxKey(threadId)
    )
    await using session = await restarted.host.open(restarted.harness, {
      user: TEST_STARTER,
      threadId
    })
    const inputId = 'go-on-after-the-restart'
    await session.resolve({
      inputId,
      resume: session.snapshot().pendingWaits.map(({ waitId }) => {
        return { interruptId: waitId, status: 'resolved', payload: 'yes' }
      })
    })
    await session.settled({ inputId })

    expect(toolResults(await session.transcript())).toContain(RESTORED_WORK)
  })

  it('logs the tool calls and the wait of a woken turn that stops at its budget', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      [{ text: 'On it.' }, bash('git status --short --untracked-files=no')],
      { limits: SPENT_AFTER_TWO_CALLS }
    )
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Check the status.'
    })
    await worker.firstTurn
    const linesBeforeWake = loggedLines.length

    await agent.workers.wakeWorker({
      threadId: worker.threadId,
      inputId: 'wake:status',
      message: 'Check it again.',
      delivery: 'followUp'
    })
    const view = await agent.host.observe(agent.harness, {
      threadId: worker.threadId
    })
    await expect
      .poll(() => {
        return view.snapshot()
      })
      .toMatchObject({ pendingWaits: [{ kind: 'human' }] })
    const wakeLines = loggedLines.slice(linesBeforeWake)
    const bashCalls = wakeLines.filter((line) => {
      return line.includes('"bash call"')
    })

    expect(bashCalls.join('\n')).toContain(
      '"command":"git status --short --untracked-files=no"'
    )
    expect(wakeLines.join('\n')).toContain('"kind":"human"')
    expect(wakeLines.join('\n')).toContain('worker waits for a person')
  })

  it('ends its turn with no model call on the stop button', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      [bash('git init --quiet'), { text: 'Done.' }],
      { limits: SPENT_AFTER_ONE_CALL }
    )
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Start a repository.'
    })
    await worker.firstTurn

    await expect(
      agent.workers.stopWorker({
        threadId: worker.threadId,
        user: TEST_STARTER
      })
    ).resolves.toBe(true)
    const view = await agent.host.observe(agent.harness, {
      threadId: worker.threadId
    })
    await expect
      .poll(() => {
        return view.snapshot()
      })
      .toMatchObject({ status: 'idle', pendingWaits: [] })

    expect(agent.model.state.callCount).toBe(1)
  })

  it('goes on after any reply of its starter, and reads the reply with its question', async () => {
    const url = await createMigratedDatabase()
    const answeredPrompts: string[] = []
    await using agent = await openWorkers(
      url,
      [
        bash('git init --quiet'),
        ({ request }) => {
          answeredPrompts.push(JSON.stringify(request.systemPrompts))

          return { text: 'I stop here, as asked.' }
        }
      ],
      { limits: SPENT_AFTER_ONE_CALL }
    )
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Start a repository.'
    })
    await worker.firstTurn

    await agent.workers.messageWorker({
      threadId: worker.threadId,
      sender: TEST_STARTER,
      inputId: 'slack:answer',
      message: 'non, on verra demain'
    })
    const view = await agent.host.observe(agent.harness, {
      threadId: worker.threadId
    })
    await expect
      .poll(() => {
        return view.snapshot()
      })
      .toMatchObject({ status: 'idle', pendingWaits: [] })
    const answered = answeredPrompts.join('\n')

    expect(agent.model.state.callCount).toBe(2)
    expect(answered).toContain('Alpha used its budget')
    expect(answered).toContain('The answer: non, on verra demain')
  })

  it('ends its task blocked, with its budget as the cause, when its starter drops the task at the budget question', async () => {
    const url = await createMigratedDatabase()
    const answeredPrompts: string[] = []
    await using agent = await openWorkers(
      url,
      [
        bash('git init --quiet'),
        ({ request }) => {
          answeredPrompts.push(JSON.stringify(request.systemPrompts))

          return finishTask({
            report: undefined,
            outcome: 'blocked',
            cause: 'It used its budget.'
          })
        }
      ],
      { limits: SPENT_AFTER_ONE_CALL }
    )
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Start a repository.'
    })
    await worker.firstTurn

    await agent.workers.messageWorker({
      threadId: worker.threadId,
      sender: TEST_STARTER,
      inputId: 'slack:answer',
      message: 'non, on laisse tomber'
    })
    await waitForArchive(agent, worker.threadId)

    expect(answeredPrompts.join('\n')).toContain('finish_task')
    await expect(outcomeOf(agent, worker.threadId)).resolves.toMatchObject({
      value: 'blocked',
      cause: 'It used its budget.'
    })
  })
})

describe('the traces of a worker', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('traces its turn as one harness operation and one chat trace joined by its run, with a span per model call and per tool call, each tagged with its name and its task', async () => {
    const url = await createMigratedDatabase()
    const { observability, finishedSpans } = recordSpans()
    await using agent = await openWorkers(
      url,
      [bash('git init --quiet'), { text: 'Done.' }],
      { observability }
    )

    const worker = await agent.workers.startWorker(TICKET_START)
    await worker.firstTurn
    const spans = finishedSpans()
    const chatSpans = spans.filter(({ name }) => {
      return name !== 'harness.operation'
    })
    const traceIds = new Set(
      chatSpans.map((span) => {
        return span.spanContext().traceId
      })
    )

    expect(
      spans
        .map(({ name }) => {
          return name
        })
        .toSorted()
    ).toStrictEqual([
      'chat fake-model',
      'chat fake-model #0',
      'chat fake-model #1',
      'execute_tool bash',
      'harness.operation'
    ])
    expect(traceIds.size).toBe(1)
    const operation = spanNamed(spans, 'harness.operation')
    expect(operation.attributes).toMatchObject({
      'harness.thread_id': worker.threadId,
      'harness.operation.kind': 'chat',
      'harness.operation.status': 'completed'
    })

    for (const span of chatSpans) {
      expect(span.attributes).toMatchObject({
        'gen_ai.provider.name': 'fake',
        'harness.run_id': operation.attributes['harness.run_id'],
        'gen_ai.agent.name': 'Alpha',
        'gen_ai.conversation.id': worker.threadId,
        'workcell.task.repository': REPOSITORY,
        'workcell.task.subject': 'TASK-7'
      })
    }
  })

  it('traces the outcome of its task, with its cause, its cost and its task, when the host ends it after its last turn', async () => {
    const url = await createMigratedDatabase()
    const { observability, finishedSpans } = recordSpans()
    await using agent = await openWorkers(
      url,
      [bash('git init --quiet'), { text: 'Done.' }],
      { observability }
    )
    const worker = await agent.workers.startWorker(TICKET_START)
    await worker.firstTurn

    await agent.workers.finishWorker({
      threadId: worker.threadId,
      report: 'Closed.',
      outcome: { value: 'manual', cause: 'A person closed the pull request.' }
    })
    const outcome = await outcomeOf(agent, worker.threadId)

    expect(
      spanNamed(finishedSpans(), 'workcell.task.outcome').attributes
    ).toStrictEqual({
      'gen_ai.conversation.id': worker.threadId,
      'gen_ai.agent.name': 'Alpha',
      'workcell.task.repository': REPOSITORY,
      'workcell.task.subject': 'TASK-7',
      'workcell.task.outcome': 'manual',
      'workcell.task.outcome.cause': 'A person closed the pull request.',
      'workcell.task.cost_usd': outcome?.costUsd
    })
  })

  it('carries the tokens and the cost of its run, priced from the table when the provider reports no cost', async () => {
    const url = await createMigratedDatabase()
    const { observability, finishedSpans } = recordSpans()
    await using agent = await openWorkers(
      url,
      [bash('git init --quiet'), { text: 'Done.' }],
      { observability }
    )

    const worker = await agent.workers.startWorker(TICKET_START)
    await worker.firstTurn
    const spans = finishedSpans()
    const run = spanNamed(spans, 'chat fake-model')
    const modelCalls = [
      spanNamed(spans, 'chat fake-model #0'),
      spanNamed(spans, 'chat fake-model #1')
    ]
    expect(spanTokens(run)).toBeGreaterThan(0)

    for (const modelCall of modelCalls) {
      expect(spanCost(modelCall)).toBeCloseTo(
        spanTokens(modelCall) / TOKENS_PER_PRICE_UNIT
      )
    }

    expect(spanCost(run)).toBeCloseTo(
      modelCalls.reduce((total, modelCall) => {
        return total + Number(spanCost(modelCall))
      }, 0)
    )
  })

  it('keeps the cost that the provider reports', async () => {
    const url = await createMigratedDatabase()
    const { observability, finishedSpans } = recordSpans()
    await using agent = await openWorkers(
      url,
      [bash('git init --quiet'), { text: 'Done.' }],
      { observability, model: new ProviderCostFake('fake-model', {}) }
    )

    const worker = await agent.workers.startWorker(TICKET_START)
    await worker.firstTurn
    const spans = finishedSpans()

    expect(spanCost(spanNamed(spans, 'chat fake-model #0'))).toBe(
      PROVIDER_COST_USD
    )
    expect(spanCost(spanNamed(spans, 'chat fake-model'))).toBe(
      2 * PROVIDER_COST_USD
    )
  })

  it('puts no prompt, no answer, no tool input and no secret on a span', async () => {
    const url = await createMigratedDatabase()
    const { observability, finishedSpans } = recordSpans()
    await using agent = await openWorkers(
      url,
      [{ text: 'On it.' }, bash('env'), { text: 'The environment is set.' }],
      { observability }
    )
    const worker = await agent.workers.startWorker(TICKET_START)
    await worker.firstTurn
    await using session = await agent.host.open(agent.harness, {
      user: TEST_STARTER,
      threadId: worker.threadId
    })
    await session.setPluginSetting({ key: 'mode', value: 'bypass' })

    await session.send('Print the environment.')
    const spans = finishedSpans()
    const traced = JSON.stringify(
      spans.map(({ name, attributes, events, links, status }) => {
        return { name, attributes, events, links, status }
      })
    )

    expect(spanNamed(spans, 'execute_tool bash').attributes).toMatchObject({
      'tanstack.ai.tool.outcome': 'success'
    })
    expect(
      [
        TICKET_START.task,
        'Print the environment.',
        'The environment is set.',
        '"env"',
        ...Object.values(SANDBOX_SECRETS)
      ].filter((text) => {
        return traced.includes(text)
      })
    ).toStrictEqual([])
  })
})
