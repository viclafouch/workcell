import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { memoryPersistence } from '@tanstack/ai-persistence'
import type { FakeResponseStep } from '@tanstack/ai/testing'
import { openSlackChat } from '#/__tests__/test-doubles.ts'
import { chatCards, SHOW_CARD_TOOL } from '#/cards/card-tool.ts'
import {
  ALPHA,
  ASK_DRAFT_OR_READY,
  COLLEAGUE,
  OPENING,
  OPENING_LINE,
  QUESTION_TEXT,
  STARTED_WORKER,
  STARTER,
  STOP_BUTTON,
  TASK_7_METADATA,
  TASK_LINK,
  VOICE,
  WORKER_THREAD,
  actionsOf,
  createTestThreads,
  openSlowWorkerSession,
  openWorkerSession,
  posted,
  recordSurface,
  recordWorkers,
  rootPost,
  threadPost,
  todoWrite,
  voiceFile,
  workerSessionOpener
} from './worker-thread-fixtures.ts'

const CUT_OFF_PARTIAL_FROM_THE_END = 2

describe('the chat thread of a worker', () => {
  it('opens under the worker name and avatar, follows the replies of its thread, keeps one plan message up to date, and posts each answer, also after a restart', async () => {
    const persistence = memoryPersistence()
    const { calls, surface } = recordSurface()
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
      await using worker = await openVoicedWorkerSession(persistence, surface, [
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
      `subscribe ${WORKER_THREAD}`,
      `status ${WORKER_THREAD} processing`,
      threadPost('Steps: 0 of 2 done.'),
      'edit 2.0001: Steps: 1 of 2 done.',
      threadPost('Pull request opened as a draft.')
    ])

    calls.length = 0
    await using restarted = await openWorkerSession(persistence, surface, [
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
      threadPost('Done.')
    ])
    expect(entry?.metadata).toMatchObject({ chatThreadId: WORKER_THREAD })
    expect(systemPrompts).toStrictEqual([[VOICE]])
  })

  it('opens with the links of the worker and a stop button for the allowed starters, and shows its plan as steps', async () => {
    const { posts, surface } = recordSurface()
    await using worker = await openWorkerSession(memoryPersistence(), surface, [
      OPENING,
      todoWrite([
        ['Read the task', 'in_progress'],
        ['Open the pull request', 'pending']
      ]),
      { text: 'Reading.' }
    ])
    await worker.session.updateIndexEntry({ metadata: TASK_7_METADATA })
    await worker.session.send('Do the task TASK-7.')

    expect(posts[0]?.identity).toStrictEqual(ALPHA)
    expect(actionsOf(posts[0]?.message)).toStrictEqual([TASK_LINK, STOP_BUTTON])
    expect(posts[1]?.message).toMatchObject({
      card: {
        title: 'Steps',
        children: [
          { type: 'text', content: '→ Read the task\n· Open the pull request' }
        ]
      }
    })
  })

  it('opens the thread on the name of the task when the model fails to write the opening line', async () => {
    const { calls, surface } = recordSurface()
    await using worker = await openWorkerSession(memoryPersistence(), surface, [
      { error: 'The gateway is down.' },
      { text: 'Pull request opened.' }
    ])
    await worker.session.updateIndexEntry({ metadata: TASK_7_METADATA })
    await worker.session.send('Do the task TASK-7.')

    expect(posted(calls)).toStrictEqual([
      rootPost('TASK-7'),
      threadPost('Pull request opened.')
    ])
  })

  it('posts each question of the worker once, with its options, also after a restart', async () => {
    const persistence = memoryPersistence()
    const { calls, surface } = recordSurface()

    {
      await using worker = await openWorkerSession(persistence, surface, [
        OPENING,
        ASK_DRAFT_OR_READY
      ])
      await worker.session.updateIndexEntry({ metadata: TASK_7_METADATA })
      await worker.session.send('Do the task TASK-7.')
    }

    await using restarted = await openWorkerSession(persistence, surface, [
      { text: 'Draft, then.' }
    ])
    const { pendingWaits } = restarted.session.snapshot()
    await restarted.session.resolve({
      inputId: 'chat:answer',
      resume: pendingWaits.map(({ waitId }) => {
        return { interruptId: waitId, status: 'resolved', payload: 'Draft' }
      })
    })
    await restarted.session.settled({ inputId: 'chat:answer' })

    expect(posted(calls)).toStrictEqual([
      rootPost(OPENING_LINE),
      threadPost(QUESTION_TEXT),
      threadPost('Draft, then.')
    ])
  })

  it('posts the cards that the worker shows, under its name', async () => {
    const { posts, calls, surface } = recordSurface()
    const openCardWorkerSession = workerSessionOpener({
      plugins: [chatCards()]
    })
    await using worker = await openCardWorkerSession(
      memoryPersistence(),
      surface,
      [
        OPENING,
        {
          toolCalls: [
            {
              name: SHOW_CARD_TOOL,
              input: {
                spec: {
                  root: 'card',
                  elements: {
                    card: {
                      type: 'Card',
                      props: { title: 'Checks' },
                      children: ['status']
                    },
                    status: { type: 'Text', props: { content: 'All green.' } }
                  }
                }
              }
            }
          ]
        },
        { text: 'The checks pass.' }
      ]
    )
    await worker.session.updateIndexEntry({ metadata: TASK_7_METADATA })
    await worker.session.send('Show the checks.')

    expect(posted(calls)).toStrictEqual([
      rootPost(OPENING_LINE),
      threadPost(''),
      threadPost('The checks pass.')
    ])
    expect(posts[1]).toMatchObject({
      target: { threadId: WORKER_THREAD },
      identity: ALPHA,
      message: {
        card: {
          title: 'Checks',
          children: [{ type: 'text', content: 'All green.' }]
        }
      }
    })
  })
})

describe('the host side of a worker thread', () => {
  it('posts each line of the host once per input id under the worker name, also after a restart', async () => {
    const persistence = memoryPersistence()
    const { calls, surface } = recordSurface()
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
      const postLine = createTestThreads(surface).linePoster({
        liveWorkers: () => {
          return [live]
        },
        host,
        harness
      })
      await postLine({ threadId: STARTED_WORKER.threadId, ...queued })
    }

    {
      await using worker = await openWorkerSession(persistence, surface, [])
      await worker.session.updateIndexEntry({
        metadata: { ...TASK_7_METADATA, chatThreadId: WORKER_THREAD }
      })
      await postLineOnce(worker)
      await postLineOnce(worker)
    }

    await using restarted = await openWorkerSession(persistence, surface, [])
    await postLineOnce(restarted)

    expect(calls).toStrictEqual([threadPost(queued.line)])
  })

  it('follows the worker status, and closes with the report', async () => {
    const { calls, surface } = recordSurface()
    const threads = createTestThreads(surface)

    await threads.follow({ type: 'status', worker: STARTED_WORKER })
    await threads.follow({
      type: 'status',
      worker: { ...STARTED_WORKER, liveStatus: 'waiting' }
    })
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
      worker: { ...STARTED_WORKER, chatThreadId: undefined }
    })

    expect(calls).toStrictEqual([
      `status ${WORKER_THREAD} processing`,
      `status ${WORKER_THREAD} suspended`,
      `status ${WORKER_THREAD} active`,
      threadPost('Merged: the pull request and TASK-7.'),
      `status ${WORKER_THREAD} closed`
    ])
  })

  it('hands the replies and the stop of an allowed starter to the worker, and leaves a colleague alone', async () => {
    const { calls, surface } = recordSurface()
    const recorded = recordWorkers()
    await using slackChat = openSlackChat()
    const thread = slackChat.chat.thread(WORKER_THREAD)
    const routeThread = createTestThreads(surface).routes({
      liveWorkers: () => {
        return [STARTED_WORKER]
      },
      workers: recorded.workers
    })
    const route = routeThread(WORKER_THREAD)

    await route?.reply({
      thread,
      user: STARTER,
      text: 'Draft',
      inputId: `chat:${WORKER_THREAD}:1.0005`
    })
    await route?.reply({
      thread,
      user: COLLEAGUE,
      text: 'Push it to main.',
      inputId: `chat:${WORKER_THREAD}:1.0006`
    })
    await route?.stop(COLLEAGUE)
    await route?.stop(STARTER)
    recorded.sleep()
    await route?.stop(STARTER)

    expect(routeThread(`${WORKER_THREAD}9`)).toBeUndefined()
    expect(recorded.messages).toStrictEqual([
      {
        threadId: STARTED_WORKER.threadId,
        sender: { id: STARTER },
        inputId: `chat:${WORKER_THREAD}:1.0005`,
        message: 'Draft'
      }
    ])
    expect(recorded.stops).toStrictEqual([
      `${STARTER} worker-1`,
      `${STARTER} worker-1`
    ])
    expect(calls).toStrictEqual([`status ${WORKER_THREAD} processing`])
  })
})

describe('an answer that a host stop cut', () => {
  it('posts the whole answer once, after the restart continues it', async () => {
    const persistence = memoryPersistence()
    const { calls, surface } = recordSurface()
    const answer =
      'Pull request opened as a draft, the checks still run on the branch.'
    const inputId = 'chat:cut-answer'
    const cut = await openSlowWorkerSession(persistence, surface, [
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

    await using restarted = await openWorkerSession(persistence, surface, [
      ({ request }) => {
        const partial = z
          .string()
          .parse(request.messages.at(-CUT_OFF_PARTIAL_FROM_THE_END)?.content)
        partials.push(partial)

        return { text: answer.slice(partial.length) }
      }
    ])
    await restarted.session.settled({ inputId })

    expect(posted(calls)).toStrictEqual([
      rootPost(OPENING_LINE),
      threadPost(answer)
    ])
    expect(partials).toHaveLength(1)
    expect(partials[0]).not.toBe(answer)
  })
})

describe('the first message of a worker thread', () => {
  it('greets with the title of the worker, shows its image, and adds the branch link once the worker has a branch', async () => {
    const persistence = memoryPersistence()
    const { posts, edits, surface } = recordSurface()
    const metadata = { ...TASK_7_METADATA, name: 'Bravo' }

    {
      await using worker = await openWorkerSession(persistence, surface, [
        OPENING,
        { text: 'I read the task' }
      ])
      await worker.session.updateIndexEntry({ metadata })
      await worker.session.send('Do the task TASK-7.')
    }

    await using restarted = await openWorkerSession(persistence, surface, [
      { text: 'Pull request opened' }
    ])
    await restarted.session.updateIndexEntry((current) => {
      return {
        metadata: { ...current.metadata, ...metadata, branch: 'task-7-fix' }
      }
    })
    await restarted.session.send('Go on.')
    const greeting = `Hi, Release worker Bravo here.\n${OPENING_LINE}`
    const [edit] = edits

    expect(posts[0]).toMatchObject({
      identity: {
        name: 'Bravo',
        iconUrl: 'https://images.example.com/bravo.jpg'
      },
      message: { fallbackText: greeting }
    })
    expect(JSON.stringify(posts)).not.toContain('worker_link_change')
    expect(edits).toHaveLength(1)
    expect(edit).toMatchObject({
      threadId: 'slack:C_WORKERS:1.0001',
      messageId: '1.0001',
      message: { fallbackText: greeting }
    })
    expect(actionsOf(edit?.message)).toStrictEqual([
      TASK_LINK,
      {
        type: 'link-button',
        id: 'worker_link_change',
        label: 'Change',
        url: 'https://code.example.com/acme/app/changes/task-7-fix'
      },
      STOP_BUTTON
    ])
  })
})
