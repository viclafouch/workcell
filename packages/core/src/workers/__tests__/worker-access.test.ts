import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished
} from 'vitest'
import { definePlugin } from '@tanstack/ai-harness'
import type { FakeResponseStep } from '@tanstack/ai/testing'
import { SENDER_REFUSAL } from '#/host/allowed-senders.ts'
import { createMigratedDatabase } from '#/testing/test-database.ts'
import { TEST_STARTER } from '#/testing/test-doubles.ts'
import { FinishRefusals, TaskFacts } from '#/workers/lifecycle.ts'
import {
  ASK_CLOSE_OR_RETARGET,
  ASK_DRAFT_OR_READY,
  bash,
  COLLEAGUE,
  COMMIT_AND_SHOW_WHO,
  createOrigin,
  finishTask,
  firstWaitId,
  HOST_COMMITTER,
  loggedLines,
  REPOSITORY,
  systemPromptTexts,
  toolResults,
  WORK_ON_A_BRANCH
} from './worker-fixtures.ts'
import {
  closeWorkerTestbed,
  liveSandboxKeys,
  logTracesOf,
  openWorkers,
  openWorkerTestbed,
  runWorkerThenCrash,
  runWorkerThenStop,
  tellToStop,
  waitForArchive
} from './worker-testbed.ts'

describe('the identity of a worker', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('tells the model the facts that plugins give its task', async () => {
    const modelRequests: string[] = []
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(
      url,
      [
        ({ request }) => {
          modelRequests.push(...systemPromptTexts(request.systemPrompts))

          return { text: 'On it.' }
        }
      ],
      {
        plugins: [
          definePlugin({
            name: 'test/task-facts',
            setup: () => {
              return {
                contribute: [
                  TaskFacts.item(({ subject }) => {
                    return `The subject of this task: ${subject}.`
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
      task: 'Fix the login.',
      subject: 'TASK-8',
      branch: 'task-8-fix-the-login'
    })
    await worker.firstTurn

    expect(modelRequests.join('\n')).toContain(
      'The branch of this task: task-8-fix-the-login.\nThe subject of this task: TASK-8.'
    )
  })

  it('tells the model its worker name, its co-author line and its pull request rule', async () => {
    const modelRequests: string[] = []
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(url, [
      ({ request }) => {
        modelRequests.push(...systemPromptTexts(request.systemPrompts))

        return { text: 'On it.' }
      }
    ])

    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Fix the login.'
    })
    await worker.firstTurn

    expect(modelRequests.join('\n')).toContain(
      'You are the worker Alpha. End each commit message with the trailer of your co-author line: git commit -m "Fix the login" -m "Co-Authored-By: Alpha $CO_AUTHOR_EMAIL". Name Alpha in the body of each pull request you open.'
    )
  })

  it('commits with its co-author line, with no question', async () => {
    const url = await createMigratedDatabase()
    const worker = await runWorkerThenStop(
      url,
      [
        bash(
          'git init --quiet && git commit --quiet --allow-empty -m "Fix the login" -m "Co-Authored-By: Alpha $CO_AUTHOR_EMAIL" && git log -1 --format=%B'
        ),
        { text: 'Done.' }
      ],
      { repository: REPOSITORY, task: 'Commit.' }
    )
    await using agent = await openWorkers(url, [])
    const view = await agent.host.observe(agent.harness, {
      threadId: worker.threadId
    })

    expect(toolResults(await view.transcript())).toContain(
      String.raw`Fix the login\n\nCo-Authored-By: Alpha <noreply@example.com>`
    )
  })

  it('commits as the host git identity in a sandbox reattached after a host crash', async () => {
    const url = await createMigratedDatabase()
    const firstWorker = await runWorkerThenCrash(
      url,
      [bash('git init --quiet'), { text: 'Done.' }],
      { repository: REPOSITORY, task: 'Start a repository.' }
    )

    await using restarted = await openWorkers(url, [
      bash(COMMIT_AND_SHOW_WHO),
      { text: 'Done.' }
    ])
    await expect(liveSandboxKeys()).resolves.toContain(
      restarted.sandboxKey(firstWorker.threadId)
    )
    await using session = await restarted.host.open(restarted.harness, {
      user: TEST_STARTER,
      threadId: firstWorker.threadId
    })
    await session.setPluginSetting({ key: 'mode', value: 'bypass' })
    await session.send('Commit.')

    expect(toolResults(await session.transcript())).toContain(HOST_COMMITTER)
  })
})

describe('who starts a worker', () => {
  beforeAll(async () => {
    await openWorkerTestbed({ hasEntrySkill: true })
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('starts no worker when no plugin lets anyone start work', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(url, [{ text: 'On it.' }], {
      starterIds: []
    })

    await expect(
      agent.workers.startWorker({
        repository: REPOSITORY,
        starter: TEST_STARTER,
        task: 'Fix the login.'
      })
    ).rejects.toThrow('test-starter may not start or steer a worker.')
    expect(agent.model.state.callCount).toBe(0)
    await expect(agent.workers.listWorkers()).resolves.toStrictEqual([])
  })

  it('starts no worker for a colleague, and leaves the subject free', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(url, [{ text: 'On it.' }])

    await expect(
      agent.workers.startWorker({
        repository: REPOSITORY,
        starter: COLLEAGUE,
        task: 'Fix the login.',
        subject: 'TASK-6'
      })
    ).rejects.toThrow('colleague may not start or steer a worker.')
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Fix the login.',
      subject: 'TASK-6'
    })
    await worker.firstTurn

    expect(worker.name).toBe('Alpha')
  })

  it('refuses the input of a colleague after a host restart, with no trace in the log and no sandbox', async () => {
    const url = await createMigratedDatabase()
    const { threadId } = await runWorkerThenStop(url, [{ text: 'On it.' }], {
      repository: REPOSITORY,
      task: 'Fix the login.'
    })
    await using restarted = await openWorkers(url, [{ text: 'Pushed.' }])

    const receipt = await restarted.host.submit({
      user: COLLEAGUE,
      harness: restarted.harness,
      threadId,
      input: { op: 'prompt', message: 'Push it to main.' },
      inputId: 'push-it'
    })

    expect(receipt).toStrictEqual({
      inputId: 'push-it',
      status: 'rejected',
      reason: SENDER_REFUSAL
    })
    await expect(logTracesOf(url, 'push-it')).resolves.toBe(0)
    expect(restarted.model.state.callCount).toBe(0)
    await expect(liveSandboxKeys()).resolves.not.toContain(
      restarted.sandboxKey(threadId)
    )
  })

  it('steers a worker on the message of its starter after a host restart', async () => {
    const url = await createMigratedDatabase()
    const { threadId } = await runWorkerThenStop(url, [{ text: 'On it.' }], {
      repository: REPOSITORY,
      task: 'Fix the login.'
    })
    await using restarted = await openWorkers(url, [{ text: 'Fixed.' }])

    await restarted.workers.messageWorker({
      threadId,
      sender: TEST_STARTER,
      inputId: 'go-on',
      message: 'Go on.'
    })

    await expect
      .poll(() => {
        return restarted.model.state.callCount
      })
      .toBe(1)
  })

  it('refuses the steer of a colleague to a running worker, with no trace in the log', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(url, [
      { text: 'On it.' },
      { text: 'Pushed to main.' }
    ])
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Fix the login.'
    })
    await worker.firstTurn
    await using session = await agent.host.open(agent.harness, {
      user: COLLEAGUE,
      threadId: worker.threadId
    })

    await expect(
      session.send('Push it to main.', { inputId: 'push-it' })
    ).rejects.toThrow(SENDER_REFUSAL)
    await expect(logTracesOf(url, 'push-it')).resolves.toBe(0)
    expect(agent.model.state.callCount).toBe(1)
  })

  it('refuses the answer of a colleague to an approval after a host restart, and runs the call on the answer of its starter', async () => {
    const url = await createMigratedDatabase()
    const { threadId } = await runWorkerThenStop(url, [bash('echo merged')], {
      repository: REPOSITORY,
      task: 'Merge it.'
    })
    await using restarted = await openWorkers(url, [{ text: 'Merged.' }])
    const view = await restarted.host.observe(restarted.harness, { threadId })
    const { pendingWaits } = await view.snapshot()
    const waitId = firstWaitId(pendingWaits)
    const approval = { threadId, waitId, answer: 'once' } as const

    await expect(
      restarted.workers.answerApproval({ ...approval, approver: COLLEAGUE })
    ).rejects.toThrow(SENDER_REFUSAL)
    await expect(logTracesOf(url, `approval:${waitId}`)).resolves.toBe(0)
    await expect(view.snapshot()).resolves.toMatchObject({
      pendingWaits: [{ waitId, kind: 'approval' }]
    })

    await expect(
      restarted.workers.answerApproval({ ...approval, approver: TEST_STARTER })
    ).resolves.toBe(true)
    await expect
      .poll(() => {
        return restarted.model.state.callCount
      })
      .toBe(1)
  })

  it('refuses the answer of a colleague to a question after a host restart, and keeps the question open', async () => {
    const url = await createMigratedDatabase()
    const { threadId } = await runWorkerThenStop(url, [ASK_DRAFT_OR_READY], {
      repository: REPOSITORY,
      task: 'Ask first.'
    })
    await using restarted = await openWorkers(url, [{ text: 'Ready.' }])
    const view = await restarted.host.observe(restarted.harness, { threadId })
    const { pendingWaits } = await view.snapshot()
    const waitId = firstWaitId(pendingWaits)

    const receipt = await restarted.host.submit({
      user: COLLEAGUE,
      harness: restarted.harness,
      threadId,
      input: {
        op: 'resolve',
        resume: [{ interruptId: waitId, status: 'resolved', payload: 'Ready' }]
      },
      inputId: 'answer-ready'
    })

    expect(receipt).toStrictEqual({
      inputId: 'answer-ready',
      status: 'rejected',
      reason: SENDER_REFUSAL
    })
    await expect(logTracesOf(url, 'answer-ready')).resolves.toBe(0)
    await expect(view.snapshot()).resolves.toMatchObject({
      pendingWaits: [{ waitId, kind: 'question' }]
    })
    expect(restarted.model.state.callCount).toBe(0)
  })
})

describe('a refused finish', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('refuses the finish on the branch that the same turn created', async () => {
    const origin = await createOrigin()
    onTestFinished(async () => {
      await origin.destroy()
    })
    const url = await createMigratedDatabase()
    const refusal = 'The pull request is still open on'
    const answeredMessages: string[] = []
    const refuseOpenBranch = definePlugin({
      name: 'test/refuse-open-branch',
      setup: () => {
        return {
          contribute: [
            FinishRefusals.item(async ({ branch }) => {
              return `${refusal} ${String(branch)}`
            })
          ]
        }
      }
    })
    await using agent = await openWorkers(
      url,
      [
        { text: 'On it.' },
        bash(WORK_ON_A_BRANCH),
        finishTask({ report: 'Done.' }),
        ({ request }) => {
          answeredMessages.push(JSON.stringify(request.messages))

          return { text: 'I wait for the merge.' }
        }
      ],
      { originUrl: origin.url, plugins: [refuseOpenBranch] }
    )
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Open a pull request.'
    })
    await worker.firstTurn
    await using session = await agent.host.open(agent.harness, {
      user: TEST_STARTER,
      threadId: worker.threadId
    })
    await session.setPluginSetting({ key: 'mode', value: 'bypass' })
    await tellToStop(agent, worker.threadId)

    await expect
      .poll(() => {
        return answeredMessages.join('\n')
      })
      .toContain(`${refusal} task-9-wake-up`)
    await expect(agent.workers.listWorkers()).resolves.toMatchObject([
      { threadId: worker.threadId }
    ])
  })

  it('refuses a finish that no person asked for, in its first turn and on a host wake, and keeps the worker live', async () => {
    const url = await createMigratedDatabase()
    const answeredMessages: string[] = []
    const readRefusal: FakeResponseStep = ({ request }) => {
      answeredMessages.push(JSON.stringify(request.messages))

      return { text: 'I ask first.' }
    }
    await using agent = await openWorkers(url, [
      finishTask({ report: 'Nothing to change.' }),
      readRefusal,
      finishTask({ report: 'Merged.' }),
      readRefusal
    ])

    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Fix the login.',
      subject: 'TASK-3'
    })
    await worker.firstTurn
    await agent.workers.wakeWorker({
      threadId: worker.threadId,
      inputId: 'github:merged:1',
      message: 'The pull request is merged.',
      delivery: 'followUp'
    })

    await expect
      .poll(() => {
        return answeredMessages
      })
      .toStrictEqual([
        expect.stringContaining('No person told you to stop'),
        expect.stringContaining('No person told you to stop')
      ])
    await expect
      .poll(() => {
        return agent.workers.listWorkers()
      })
      .toMatchObject([{ threadId: worker.threadId, liveStatus: 'idle' }])
  })

  it('ends the worker once a person answers its question with a stop, also after a host restart', async () => {
    const url = await createMigratedDatabase()
    const asker = await runWorkerThenStop(url, [ASK_CLOSE_OR_RETARGET], {
      repository: REPOSITORY,
      task: 'Fix the login.',
      subject: 'TASK-3'
    })
    await using restarted = await openWorkers(url, [
      finishTask({ report: 'Closed: dev already does it.' })
    ])

    await restarted.workers.messageWorker({
      threadId: asker.threadId,
      sender: TEST_STARTER,
      inputId: 'slack:answer',
      message: 'Close'
    })

    await waitForArchive(restarted, asker.threadId)
    expect(
      loggedLines.filter((line) => {
        return line.includes('Closed: dev already does it.')
      })
    ).toHaveLength(1)
  })

  it('keeps a worker live when a plugin refuses its finish, and gives the model the reason', async () => {
    const url = await createMigratedDatabase()
    const refusal = 'The pull request 12 is still open.'
    const answeredMessages: string[] = []
    const refuseFinish = definePlugin({
      name: 'test/refuse-finish',
      setup: () => {
        return {
          contribute: [
            FinishRefusals.item(async () => {
              return refusal
            })
          ]
        }
      }
    })
    await using agent = await openWorkers(
      url,
      [
        { text: 'On it.' },
        finishTask({ report: 'Done.' }),
        ({ request }) => {
          answeredMessages.push(JSON.stringify(request.messages))

          return { text: 'I wait for the merge.' }
        }
      ],
      { plugins: [refuseFinish] }
    )

    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Fix the login.',
      subject: 'TASK-3'
    })
    await worker.firstTurn
    await tellToStop(agent, worker.threadId)

    await expect
      .poll(() => {
        return answeredMessages.join('\n')
      })
      .toContain(refusal)
    await expect(agent.workers.listWorkers()).resolves.toMatchObject([
      { threadId: worker.threadId }
    ])
  })
})
