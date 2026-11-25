import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { definePlugin } from '@tanstack/ai-harness'
import { runCli } from '@tanstack/ai-harness-cli'
import { createMigratedDatabase } from '#/testing/test-database.ts'
import { TEST_STARTER } from '#/testing/test-doubles.ts'
import {
  ASK_DRAFT_OR_READY,
  bash,
  ENTRY_SKILL,
  firstWaitId,
  FOUR_NAMES,
  holdUntil,
  loggedLines,
  meetAt,
  REPOSITORY,
  SANDBOX_SECRETS,
  toolResults,
  TWO_NAMES
} from './worker-fixtures.ts'
import {
  closeWorkerTestbed,
  openWorkers,
  openWorkerTestbed,
  runWorkerThenCrash,
  runWorkerThenStop,
  type OpenedWorkers
} from './worker-testbed.ts'

async function startTask(agent: OpenedWorkers, task: string) {
  const worker = await agent.workers.startWorker({
    repository: REPOSITORY,
    starter: TEST_STARTER,
    task
  })
  await worker.firstTurn

  return worker.name
}

describe('a worker', () => {
  beforeAll(async () => {
    await openWorkerTestbed({ hasEntrySkill: true })
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('starts from its entry skill, under a free worker name', async () => {
    const firstMessages: string[] = []
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(url, [
      ({ request }) => {
        firstMessages.push(JSON.stringify(request.messages))

        return { text: 'On it.' }
      }
    ])

    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'TASK-1',
      entrySkill: ENTRY_SKILL,
      subject: 'TASK-1'
    })
    await worker.firstTurn

    expect(worker.name).toBe('Alpha')
    expect(firstMessages.join('\n')).toContain(
      'Use the start-ticket skill: TASK-1'
    )
    await expect(
      agent.host.sessions.get({ threadId: worker.threadId })
    ).resolves.toMatchObject({
      metadata: {
        name: 'Alpha',
        task: 'TASK-1',
        entrySkill: ENTRY_SKILL,
        repository: REPOSITORY,
        subject: 'TASK-1'
      }
    })
  })

  it('runs two workers at the same time, each in its own sandbox', async () => {
    const url = await createMigratedDatabase()
    const initRepository = meetAt(2, bash('git init'))
    await using agent = await openWorkers(
      url,
      [initRepository, initRepository, { text: 'Done.' }, { text: 'Done.' }],
      { workerNames: TWO_NAMES }
    )

    const workers = await Promise.all([
      agent.workers.startWorker({
        repository: REPOSITORY,
        starter: TEST_STARTER,
        task: 'First task.'
      }),
      agent.workers.startWorker({
        repository: REPOSITORY,
        starter: TEST_STARTER,
        task: 'Second task.'
      })
    ])
    await Promise.all(
      workers.map(({ firstTurn }) => {
        return firstTurn
      })
    )
    const folders = await Promise.all(
      workers.map(async ({ threadId }) => {
        const view = await agent.host.observe(agent.harness, { threadId })

        return toolResults(await view.transcript())
      })
    )

    expect(
      workers
        .map(({ name }) => {
          return name
        })
        .toSorted()
    ).toStrictEqual(['Alpha', 'Bravo'])
    expect(folders[0]).toContain('exit code: 0')
    expect(folders[0]).not.toBe(folders[1])
  })

  it('lists each worker with its live status and its usage, after a restart', async () => {
    const url = await createMigratedDatabase()
    await runWorkerThenStop(url, [{ text: 'On it.' }], {
      repository: REPOSITORY,
      task: 'Fix the login.',
      subject: 'TASK-2'
    })

    await using restarted = await openWorkers(url, [])

    await expect(restarted.workers.listWorkers()).resolves.toMatchObject([
      {
        name: 'Alpha',
        task: 'Fix the login.',
        repository: REPOSITORY,
        subject: 'TASK-2',
        liveStatus: 'idle',
        usage: { turns: 1 }
      }
    ])
  })

  it('keeps a field that the host adds, with the rest of its metadata, after a restart', async () => {
    const url = await createMigratedDatabase()
    const threadId = await (async () => {
      await using agent = await openWorkers(url, [{ text: 'On it.' }])
      const worker = await agent.workers.startWorker({
        repository: REPOSITORY,
        starter: TEST_STARTER,
        task: 'Fix the login.',
        subject: 'TASK-3'
      })
      await worker.firstTurn
      await agent.workers.updateWorker({
        threadId: worker.threadId,
        metadata: { reviewer: 'U_REVIEWER' }
      })

      return worker.threadId
    })()

    await using restarted = await openWorkers(url, [])

    await expect(restarted.workers.listWorkers()).resolves.toMatchObject([
      {
        threadId,
        name: 'Alpha',
        task: 'Fix the login.',
        repository: REPOSITORY,
        subject: 'TASK-3',
        reviewer: 'U_REVIEWER'
      }
    ])
  })

  it('never gives a worker name twice, also after a restart', async () => {
    const url = await createMigratedDatabase()
    const options = { workerNames: TWO_NAMES }
    const first = await (async () => {
      await using agent = await openWorkers(url, [{ text: 'On it.' }], options)

      return await startTask(agent, 'First task.')
    })()

    await using restarted = await openWorkers(
      url,
      [{ text: 'On it.' }],
      options
    )
    const second = await startTask(restarted, 'Second task.')

    expect([first, second].toSorted()).toStrictEqual(TWO_NAMES)
  })

  it('reattaches its sandbox after a host crash, with its files and its secrets', async () => {
    const url = await createMigratedDatabase()
    const { threadId } = await runWorkerThenCrash(
      url,
      [
        {
          toolCalls: [
            {
              name: 'write_file',
              input: { path: 'kept.md', content: 'kept across a restart\n' }
            }
          ]
        },
        { text: 'Written.' }
      ],
      { repository: REPOSITORY, task: 'Write a file.' }
    )

    await using restarted = await openWorkers(url, [
      { toolCalls: [{ name: 'read_file', input: { path: 'kept.md' } }] },
      bash('env'),
      { text: 'Read.' }
    ])
    await using session = await restarted.host.open(restarted.harness, {
      user: TEST_STARTER,
      threadId
    })
    await session.setPluginSetting({ key: 'mode', value: 'bypass' })
    await session.send('Read the file, then run env.')
    const results = toolResults(await session.transcript())

    expect(results).toContain('kept across a restart')
    expect(results).toContain('ASSETS_CDN_TOKEN=[redacted]')
  })

  it('answers in the terminal through its runCli entry', async () => {
    const url = await createMigratedDatabase()
    const output: string[] = []
    await using agent = await openWorkers(url, [
      { text: 'On it.' },
      { text: 'The tests pass.' }
    ])
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Run the tests.'
    })
    await worker.firstTurn

    const exitCode = await runCli(agent.harness, {
      user: TEST_STARTER,
      host: agent.host,
      argv: ['--thread', worker.threadId, '-p', 'Do they pass?'],
      stdout: {
        write: (text: string) => {
          output.push(text)
        }
      }
    })

    expect(exitCode).toBe(0)
    expect(output.join('')).toContain('The tests pass.')
  })
})

describe('the secrets of a worker', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('shows the model and the log no sandbox secret when it runs env', async () => {
    const url = await createMigratedDatabase()
    const modelRequests: string[] = []
    await using agent = await openWorkers(url, [
      { text: 'On it.' },
      bash('env'),
      ({ request }) => {
        modelRequests.push(JSON.stringify(request.messages))

        return { text: 'Done.' }
      }
    ])
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Wait.'
    })
    await worker.firstTurn

    await using session = await agent.host.open(agent.harness, {
      user: TEST_STARTER,
      threadId: worker.threadId
    })
    await session.setPluginSetting({ key: 'mode', value: 'bypass' })
    await session.send('Run env.')
    const results = toolResults(await session.transcript())
    const seenByModelAndLog = [results, ...modelRequests, ...loggedLines].join(
      '\n'
    )

    expect(results).toContain('GH_TOKEN=[redacted]')
    expect(seenByModelAndLog).not.toContain(SANDBOX_SECRETS.GITHUB_TOKEN)
    expect(seenByModelAndLog).not.toContain(SANDBOX_SECRETS.NPM_TOKEN)
    expect(seenByModelAndLog).not.toContain(SANDBOX_SECRETS.ASSETS_CDN_TOKEN)
  })

  it('logs a bash call with each sandbox secret of its command redacted', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(url, [
      { text: 'On it.' },
      bash(`echo ${SANDBOX_SECRETS.GITHUB_TOKEN} ${SANDBOX_SECRETS.NPM_TOKEN}`),
      { text: 'Done.' }
    ])
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Wait.'
    })
    await worker.firstTurn
    const linesBefore = loggedLines.length

    await using session = await agent.host.open(agent.harness, {
      user: TEST_STARTER,
      threadId: worker.threadId
    })
    await session.setPluginSetting({ key: 'mode', value: 'bypass' })
    await session.send('Run the echo.')
    const bashLines = loggedLines.slice(linesBefore).filter((line) => {
      return line.includes('bash call')
    })

    expect(bashLines.join('\n')).toContain('[redacted]')
    expect(bashLines.join('\n')).not.toContain(SANDBOX_SECRETS.GITHUB_TOKEN)
    expect(bashLines.join('\n')).not.toContain(SANDBOX_SECRETS.NPM_TOKEN)
  })
})

describe('the approval of a worker', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('waits for a person on an approval, and runs the call after a yes, also after a host restart', async () => {
    const url = await createMigratedDatabase()
    const answeredMessages: string[] = []
    const worker = await runWorkerThenStop(url, [bash('echo merged')], {
      repository: REPOSITORY,
      task: 'Merge it.'
    })
    await using restarted = await openWorkers(url, [
      ({ request }) => {
        answeredMessages.push(JSON.stringify(request.messages))

        return { text: 'Merged.' }
      }
    ])
    const view = await restarted.host.observe(restarted.harness, {
      threadId: worker.threadId
    })
    const { pendingWaits } = await view.snapshot()

    expect(pendingWaits).toMatchObject([{ kind: 'approval', turn: true }])

    const approval = {
      threadId: worker.threadId,
      waitId: firstWaitId(pendingWaits),
      approver: TEST_STARTER,
      answer: 'once'
    } as const
    await expect(restarted.workers.answerApproval(approval)).resolves.toBe(true)
    await expect
      .poll(() => {
        return answeredMessages.join('\n')
      })
      .toContain('exit code: 0')

    await expect(restarted.workers.answerApproval(approval)).resolves.toBe(
      false
    )
    await expect(view.snapshot()).resolves.toMatchObject({ pendingWaits: [] })
  })

  it('refuses the call after a no, and lets the model go on', async () => {
    const url = await createMigratedDatabase()
    const answeredMessages: string[] = []
    await using agent = await openWorkers(url, [
      bash('gh pr merge 12 --squash'),
      ({ request }) => {
        answeredMessages.push(JSON.stringify(request.messages))

        return { text: 'I leave the merge to a person.' }
      }
    ])
    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Merge it.'
    })
    await worker.firstTurn
    const view = await agent.host.observe(agent.harness, {
      threadId: worker.threadId
    })
    const { pendingWaits } = await view.snapshot()

    await agent.workers.answerApproval({
      threadId: worker.threadId,
      waitId: firstWaitId(pendingWaits),
      approver: TEST_STARTER,
      answer: 'reject'
    })

    await expect
      .poll(() => {
        return answeredMessages.join('\n')
      })
      .toContain('A person rejected this call')
    await expect(view.snapshot()).resolves.toMatchObject({ pendingWaits: [] })
  })
})

describe('the question of a worker', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('keeps its question open with no turn slot held, and goes on with the answer', async () => {
    const url = await createMigratedDatabase()
    const released = Promise.withResolvers<null>()
    const answeredMessages: string[] = []
    await using agent = await openWorkers(
      url,
      [
        ASK_DRAFT_OR_READY,
        holdUntil(released.promise),
        holdUntil(released.promise),
        ({ request }) => {
          answeredMessages.push(JSON.stringify(request.messages))

          return { text: 'I open it as a draft.' }
        }
      ],
      { workerNames: FOUR_NAMES }
    )

    const asker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Ask first.'
    })
    await asker.firstTurn
    const holders = await Promise.all(
      ['First', 'Second'].map((task) => {
        return agent.workers.startWorker({
          repository: REPOSITORY,
          starter: TEST_STARTER,
          task
        })
      })
    )
    await expect
      .poll(async () => {
        const listed = await agent.workers.listWorkers()

        return listed
          .filter(({ threadId }) => {
            return threadId !== asker.threadId
          })
          .map(({ liveStatus }) => {
            return liveStatus
          })
      })
      .toStrictEqual(['running', 'running'])
    released.resolve(null)
    await Promise.all(
      holders.map(({ firstTurn }) => {
        return firstTurn
      })
    )

    const session = await agent.host.open(agent.harness, {
      user: TEST_STARTER,
      threadId: asker.threadId
    })
    const { pendingWaits } = session.snapshot()
    const inputId = 'answer-the-question'
    await session.resolve({
      inputId,
      resume: pendingWaits.map(({ waitId }) => {
        return { interruptId: waitId, status: 'resolved', payload: 'Draft' }
      })
    })
    await session.settled({ inputId })

    expect(pendingWaits).toMatchObject([{ kind: 'question', turn: true }])
    expect(answeredMessages.join('\n')).toContain('Answer: Draft')
  })
})

describe('the start hook of a worker', () => {
  beforeAll(async () => {
    await openWorkerTestbed()
  })

  afterAll(async () => {
    await closeWorkerTestbed()
  })

  it('runs the start hook before the first turn, and the first turn reads the metadata it returned', async () => {
    const events: string[] = []
    const url = await createMigratedDatabase()
    const readsTheStartMetadata = definePlugin({
      name: 'test/reads-the-start-metadata',
      setup: (setupContext) => {
        return {
          onTurnStart: async () => {
            const entry = await setupContext.session.indexEntry()
            events.push(`turn in ${String(entry?.metadata?.chatThreadId)}`)
          }
        }
      }
    })
    await using agent = await openWorkers(url, [{ text: 'On it.' }], {
      plugins: [readsTheStartMetadata],
      onWorkerStart: async ({ name, subject }) => {
        events.push(`start ${name} on ${subject}`)

        return { chatThreadId: 'chat-thread-1' }
      }
    })

    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Fix the login.',
      subject: 'TASK-1'
    })
    await worker.firstTurn

    expect(events).toStrictEqual([
      'start Alpha on TASK-1',
      'turn in chat-thread-1'
    ])
  })

  it('starts a second worker while the start hook of the first one still waits', async () => {
    const url = await createMigratedDatabase()
    const secondHook = Promise.withResolvers<null>()
    const hooks = new Map([
      [
        'First task.',
        async () => {
          await secondHook.promise
        }
      ],
      [
        'Second task.',
        async () => {
          secondHook.resolve(null)
        }
      ]
    ])
    await using agent = await openWorkers(
      url,
      [{ text: 'On it.' }, { text: 'On it.' }],
      {
        workerNames: TWO_NAMES,
        onWorkerStart: async ({ task }) => {
          await hooks.get(task)?.()

          return {}
        }
      }
    )

    const workers = await Promise.all(
      [...hooks.keys()].map((task) => {
        return agent.workers.startWorker({
          repository: REPOSITORY,
          starter: TEST_STARTER,
          task
        })
      })
    )
    await Promise.all(
      workers.map(({ firstTurn }) => {
        return firstTurn
      })
    )

    expect(
      workers
        .map(({ name }) => {
          return name
        })
        .toSorted()
    ).toStrictEqual(['Alpha', 'Bravo'])
  })

  it('starts the worker when the start hook fails', async () => {
    const url = await createMigratedDatabase()
    await using agent = await openWorkers(url, [{ text: 'On it.' }], {
      onWorkerStart: async () => {
        throw new Error('The chat is down.')
      }
    })

    const worker = await agent.workers.startWorker({
      repository: REPOSITORY,
      starter: TEST_STARTER,
      task: 'Fix the login.'
    })
    await worker.firstTurn

    await expect(agent.workers.listWorkers()).resolves.toMatchObject([
      { name: 'Alpha', task: 'Fix the login.' }
    ])
  })
})
