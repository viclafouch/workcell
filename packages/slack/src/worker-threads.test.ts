import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { memoryPersistence } from '@tanstack/ai-persistence'
import type { FakeResponseStep } from '@tanstack/ai/testing'
import {
  ASK_DRAFT_OR_READY,
  COLLEAGUE,
  OPENING,
  OPENING_LINE,
  QUESTION_TEXT,
  STARTED_WORKER,
  STARTER,
  TASK_7_METADATA,
  TASK_BUTTON,
  VOICE,
  WORKER_CHANNEL,
  WORKER_THREAD,
  createTestThreads,
  openSlowWorkerSession,
  openWorkerSession,
  openingBlocks,
  recordSlack,
  recordWorkers,
  rootPost,
  todoWrite,
  voiceFile,
  workerSessionOpener
} from './worker-thread-fixtures.ts'

const CUT_OFF_PARTIAL_FROM_THE_END = 2

describe('the Slack thread of a worker', () => {
  it('opens under the worker name and avatar, keeps one plan message up to date, and posts each answer', async () => {
    const persistence = memoryPersistence()
    const { calls, web } = recordSlack()
    const steps = [
      todoWrite([
        ['Read the task', 'in_progress'],
        ['Open the pull request', 'pending']
      ]),
      todoWrite([
        ['Read the task', 'done'],
        ['Open the pull request', 'in_progress']
      ]),
      { text: 'Pull request opened as a draft.' }
    ]
    const systemPrompts: unknown[] = []
    const opening: FakeResponseStep = ({ request }) => {
      systemPrompts.push(request.systemPrompts)

      return OPENING
    }

    const openVoicedWorkerSession = workerSessionOpener({
      voice: await voiceFile()
    })

    {
      await using worker = await openVoicedWorkerSession(persistence, web, [
        opening,
        ...steps
      ])
      await worker.session.updateIndexEntry({
        title: 'Alpha · TASK-7',
        metadata: TASK_7_METADATA
      })
      await worker.session.send('Do the task TASK-7.')
    }

    expect(calls).toStrictEqual([
      rootPost(OPENING_LINE),
      `Alpha status 1.0001 processing Alpha · TASK-7 ${STARTER}`,
      'Alpha https://images.example.com/alpha.png post 1.0001: Steps: 0 of 2 done. [{"type":"plan","title":"Steps","tasks":[{"task_id":"step-1","title":"Read the task","status":"in_progress"},{"task_id":"step-2","title":"Open the pull request","status":"pending"}]}]',
      'edit 2.0001: Steps: 1 of 2 done.',
      'Alpha https://images.example.com/alpha.png post 1.0001: Pull request opened as a draft.'
    ])

    calls.length = 0
    await using restarted = await openWorkerSession(persistence, web, [
      todoWrite([
        ['Read the task', 'done'],
        ['Open the pull request', 'done']
      ]),
      { text: 'Done.' }
    ])
    await restarted.session.send('Go on.')
    const entry = await restarted.session.indexEntry()

    expect(calls).toStrictEqual([
      'edit 2.0001: Steps: 2 of 2 done.',
      'Alpha https://images.example.com/alpha.png post 1.0001: Done.'
    ])
    expect(entry?.metadata).toMatchObject({
      slackChannel: WORKER_CHANNEL,
      slackThreadTs: '1.0001'
    })
    expect(systemPrompts).toStrictEqual([[VOICE]])
  })

  it('opens the thread on the name of the task when the model fails to write the opening line', async () => {
    const { calls, web } = recordSlack()
    await using worker = await openWorkerSession(memoryPersistence(), web, [
      { error: 'The gateway is down.' },
      { text: 'Pull request opened.' }
    ])
    await worker.session.updateIndexEntry({ metadata: TASK_7_METADATA })
    await worker.session.send('Do the task TASK-7.')

    expect(
      calls.filter((call) => {
        return call.includes(' post ')
      })
    ).toStrictEqual([
      rootPost('TASK-7'),
      'Alpha https://images.example.com/alpha.png post 1.0001: Pull request opened.'
    ])
  })

  it('posts each question of the worker once, with its options and no English how-to line, also after a restart', async () => {
    const persistence = memoryPersistence()
    const { calls, web } = recordSlack()

    {
      await using worker = await openWorkerSession(persistence, web, [
        OPENING,
        ASK_DRAFT_OR_READY
      ])
      await worker.session.updateIndexEntry({ metadata: TASK_7_METADATA })
      await worker.session.send('Do the task TASK-7.')
    }

    await using restarted = await openWorkerSession(persistence, web, [
      { text: 'Draft, then.' }
    ])
    const { pendingWaits } = restarted.session.snapshot()
    await restarted.session.resolve({
      inputId: 'slack:answer',
      resume: pendingWaits.map(({ waitId }) => {
        return { interruptId: waitId, status: 'resolved', payload: 'Draft' }
      })
    })
    await restarted.session.settled({ inputId: 'slack:answer' })

    expect(
      calls.filter((call) => {
        return call.includes(' post ')
      })
    ).toStrictEqual([
      rootPost(OPENING_LINE),
      `Alpha https://images.example.com/alpha.png post 1.0001: ${QUESTION_TEXT}`,
      'Alpha https://images.example.com/alpha.png post 1.0001: Draft, then.'
    ])
  })

  it('posts each line of the host once per input id under the worker name, also after a restart', async () => {
    const persistence = memoryPersistence()
    const { calls, web } = recordSlack()
    const queued = {
      inputId: 'github:acme/app#42:merge-queue-entry:queued-1',
      line: 'In the merge queue: https://code.example.com/acme/app/pull/42'
    }

    const postLineOnce = async ({
      host,
      harness
    }: Awaited<ReturnType<typeof openWorkerSession>>) => {
      const entry = await host.sessions.get({
        threadId: STARTED_WORKER.threadId
      })
      const live = { ...STARTED_WORKER, ...entry?.metadata }
      const postLine = createTestThreads(web).linePoster({
        liveWorkers: () => {
          return [live]
        },
        host,
        harness
      })
      await postLine({ threadId: STARTED_WORKER.threadId, ...queued })
    }

    {
      await using worker = await openWorkerSession(persistence, web, [])
      await worker.session.updateIndexEntry({
        metadata: {
          ...TASK_7_METADATA,
          slackChannel: WORKER_CHANNEL,
          slackThreadTs: WORKER_THREAD.threadTs
        }
      })
      await postLineOnce(worker)
      await postLineOnce(worker)
    }

    await using restarted = await openWorkerSession(persistence, web, [])
    await postLineOnce(restarted)

    expect(calls).toStrictEqual([
      `Alpha https://images.example.com/alpha.png post 1.0001: ${queued.line}`
    ])
  })

  it('follows the worker status, and closes with the report', async () => {
    const { calls, web } = recordSlack()
    const threads = createTestThreads(web)
    const waiting = { ...STARTED_WORKER, liveStatus: 'waiting' } as const

    await threads.follow({ type: 'status', worker: STARTED_WORKER })
    await threads.follow({ type: 'status', worker: waiting })
    await threads.follow({
      type: 'status',
      worker: { ...STARTED_WORKER, liveStatus: 'idle' }
    })
    await threads.follow({
      type: 'finished',
      worker: {
        ...STARTED_WORKER,
        report: 'Merged: the pull request and TASK-7.'
      }
    })
    await threads.follow({
      type: 'status',
      worker: { ...STARTED_WORKER, slackThreadTs: undefined }
    })

    expect(calls).toStrictEqual([
      'Alpha status 1.0001 processing',
      'Alpha status 1.0001 suspended',
      'Alpha status 1.0001 active',
      'Alpha https://images.example.com/alpha.png post 1.0001: Merged: the pull request and TASK-7.',
      'Alpha status 1.0001 closed'
    ])
  })

  it('hands the replies and the stop button of an allowed starter to the worker, and leaves a colleague alone', async () => {
    const { calls, web } = recordSlack()
    const recorded = recordWorkers()
    const routeThread = createTestThreads(web).routes({
      liveWorkers: () => {
        return [STARTED_WORKER]
      },
      workers: recorded.workers
    })
    const route = routeThread(WORKER_THREAD)

    await route?.reply({
      ...WORKER_THREAD,
      user: STARTER,
      team: 'T_TEAM',
      text: 'Draft',
      ts: '1.0005'
    })
    await route?.reply({
      ...WORKER_THREAD,
      user: COLLEAGUE,
      team: 'T_TEAM',
      text: 'Push it to main.',
      ts: '1.0006'
    })
    await route?.stop(COLLEAGUE)
    await route?.stop(STARTER)
    recorded.sleep()
    await route?.stop(STARTER)

    expect(
      routeThread({ ...WORKER_THREAD, threadTs: '9.0001' })
    ).toBeUndefined()
    expect(recorded.messages).toStrictEqual([
      {
        threadId: STARTED_WORKER.threadId,
        sender: { id: STARTER },
        inputId: `slack:${WORKER_CHANNEL}:1.0005`,
        message: 'Draft'
      }
    ])
    expect(recorded.stops).toStrictEqual([
      `${STARTER} worker-1`,
      `${STARTER} worker-1`
    ])
    expect(calls).toStrictEqual(['Alpha status 1.0001 processing'])
  })
})

describe('an answer that a host stop cut', () => {
  it('posts the whole answer once, after the restart continues it', async () => {
    const persistence = memoryPersistence()
    const { calls, web } = recordSlack()
    const answer =
      'Pull request opened as a draft, the checks still run on the branch.'
    const inputId = 'slack:cut-answer'
    const cut = await openSlowWorkerSession(persistence, web, [
      OPENING,
      { text: answer }
    ])
    await cut.session.updateIndexEntry({ metadata: TASK_7_METADATA })
    const streamed = new Promise<void>((resolve) => {
      cut.session.onEvent('TEXT_MESSAGE_CONTENT', () => {
        resolve()
      })
    })
    await cut.session.send('Do the task TASK-7.', { inputId }).receipt
    await streamed
    await cut.host.close({ recoverable: true })
    const partials: string[] = []

    await using restarted = await openWorkerSession(persistence, web, [
      ({ request }) => {
        const partial = z
          .string()
          .parse(request.messages.at(-CUT_OFF_PARTIAL_FROM_THE_END)?.content)
        partials.push(partial)

        return { text: answer.slice(partial.length) }
      }
    ])
    await restarted.session.settled({ inputId })

    expect(
      calls.filter((call) => {
        return call.includes(' post ')
      })
    ).toStrictEqual([
      rootPost(OPENING_LINE),
      `Alpha https://images.example.com/alpha.png post 1.0001: ${answer}`
    ])
    expect(partials).toHaveLength(1)
    expect(partials[0]).not.toBe(answer)
  })
})

describe('the first message of a worker thread', () => {
  it('greets with the title of the worker, shows its image, and adds the branch link once the worker has a branch', async () => {
    const persistence = memoryPersistence()
    const { posts, edits, web } = recordSlack()
    const metadata = { ...TASK_7_METADATA, name: 'Bravo' }

    {
      await using worker = await openWorkerSession(persistence, web, [
        OPENING,
        { text: 'I read the task' }
      ])
      await worker.session.updateIndexEntry({ metadata })
      await worker.session.send('Do the task TASK-7.')
    }

    await using restarted = await openWorkerSession(persistence, web, [
      { text: 'Pull request opened' }
    ])
    await restarted.session.updateIndexEntry((current) => {
      return {
        metadata: { ...current.metadata, ...metadata, branch: 'task-7-fix' }
      }
    })
    await restarted.session.send('Go on.')
    const greeting = `Hi, Release worker Bravo here.\n${OPENING_LINE}`

    expect(posts[0]).toMatchObject({
      identity: {
        username: 'Bravo',
        icon: { url: 'https://images.example.com/bravo.jpg' }
      },
      text: greeting
    })
    expect(JSON.stringify(posts)).not.toContain('worker_link_change')
    expect(edits).toStrictEqual([
      {
        channel: WORKER_CHANNEL,
        ts: '1.0001',
        text: greeting,
        blocks: openingBlocks(greeting, [
          TASK_BUTTON,
          {
            type: 'button',
            action_id: 'worker_link_change',
            text: { type: 'plain_text', text: 'Change' },
            url: 'https://code.example.com/acme/app/changes/task-7-fix'
          }
        ])
      }
    ])
  })
})
