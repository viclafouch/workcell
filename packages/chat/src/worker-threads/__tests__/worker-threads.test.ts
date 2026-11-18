import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ChatMiddleware } from '@tanstack/ai'
import { definePlugin, type HarnessRunContext } from '@tanstack/ai-harness'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { workerMetadataSchema } from '@workcell/core'
import { openSlackChat } from '#/__tests__/test-doubles.ts'
import { chatCards, SHOW_CARD_TOOL } from '#/cards/card-tool.ts'
import {
  ALPHA,
  ASK_DRAFT_OR_READY,
  COLLEAGUE,
  QUESTION_TEXT,
  STARTED_WORKER,
  STARTER,
  STARTING_LINE,
  STOP_BUTTON,
  TASK_7_METADATA,
  TASK_LINK,
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
  threadStatus,
  todoWrite,
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
    {
      await using worker = await openWorkerSession(persistence, surface, steps)
      await worker.session.updateIndexEntry({
        title: 'Alpha · TASK-7',
        metadata: TASK_7_METADATA
      })
      await worker.session.send('Do the task TASK-7.')
    }

    expect(calls).toStrictEqual([
      rootPost(STARTING_LINE),
      `subscribe ${WORKER_THREAD}`,
      threadStatus('processing'),
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
  })

  it('opens with the links of the worker and a stop button for the allowed starters, and shows its plan as steps', async () => {
    const { posts, surface } = recordSurface()
    await using worker = await openWorkerSession(memoryPersistence(), surface, [
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

  it('posts each question of the worker once, with its options, also after a restart', async () => {
    const persistence = memoryPersistence()
    const { calls, surface } = recordSurface()

    {
      await using worker = await openWorkerSession(persistence, surface, [
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
      rootPost(STARTING_LINE),
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
      rootPost(STARTING_LINE),
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

  it('follows the worker status under its name, names a queued worker as queued, and closes with the report and no stop button', async () => {
    const { calls, edits, surface } = recordSurface()
    const threads = createTestThreads(surface)

    await threads.follow({
      type: 'status',
      worker: { ...STARTED_WORKER, liveStatus: 'queued' }
    })
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
        chatOpening: { messageId: '1.0001', links: '[]' },
        report: 'Merged: the pull request and TASK-7.'
      }
    })
    await threads.follow({
      type: 'status',
      worker: { ...STARTED_WORKER, chatThreadId: undefined }
    })

    expect(calls).toStrictEqual([
      threadStatus('processing', 'Alpha (queued)'),
      threadStatus('processing'),
      threadStatus('suspended'),
      threadStatus('active'),
      threadPost('Merged: the pull request and TASK-7.'),
      threadStatus('closed'),
      expect.stringContaining('edit 1.0001: ')
    ])
    expect(actionsOf(edits[0]?.message)).toStrictEqual([TASK_LINK])
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
      files: [],
      inputId: `chat:${WORKER_THREAD}:1.0005`
    })
    await route?.reply({
      thread,
      user: COLLEAGUE,
      text: 'Push it to main.',
      files: [],
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
        message: 'Draft',
        files: []
      }
    ])
    expect(recorded.stops).toStrictEqual([
      `${STARTER} worker-1`,
      `${STARTER} worker-1`
    ])
    expect(calls).toStrictEqual([threadStatus('processing')])
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
      rootPost(STARTING_LINE),
      threadPost(answer)
    ])
    expect(partials).toHaveLength(1)
    expect(partials[0]).not.toBe(answer)
  })
})

describe('the opening of a worker thread', () => {
  it('opens the thread when the worker starts, before any turn, and the first turn posts its plan there with no second intro', async () => {
    const { calls, surface } = recordSurface()
    await using worker = await openWorkerSession(memoryPersistence(), surface, [
      todoWrite([['Read the task', 'in_progress']]),
      { text: 'Reading.' }
    ])

    const opened = await worker.threads.open(TASK_7_METADATA)

    expect(calls).toStrictEqual([
      rootPost(STARTING_LINE),
      `subscribe ${WORKER_THREAD}`,
      threadStatus('processing')
    ])

    calls.length = 0
    await worker.session.updateIndexEntry({
      metadata: { ...TASK_7_METADATA, ...opened }
    })
    await worker.session.send('Do the task TASK-7.')

    expect(posted(calls)).toStrictEqual([
      threadPost('Steps: 0 of 1 done.'),
      threadPost('Reading.')
    ])
  })

  it('keeps the thread it posted when the chat fails to follow it', async () => {
    const { calls, surface } = recordSurface()
    const unfollowedSurface = {
      ...surface,
      subscribe: async () => {
        throw new Error('The chat state is down.')
      }
    }
    await using worker = await openWorkerSession(
      memoryPersistence(),
      unfollowedSurface,
      [{ text: 'Reading.' }]
    )

    const opened = await worker.threads.open(TASK_7_METADATA)
    await worker.session.updateIndexEntry({
      metadata: { ...TASK_7_METADATA, ...opened }
    })
    await worker.session.send('Do the task TASK-7.')

    expect(posted(calls)).toStrictEqual([
      rootPost(STARTING_LINE),
      threadPost('Reading.')
    ])
  })

  it('keeps one thread when the host restarts while the sandbox gets ready', async () => {
    const persistence = memoryPersistence()
    const { calls, surface } = recordSurface()
    const inputId = 'tracker:TASK-7'
    const setupStarted = Promise.withResolvers<null>()
    const sandboxSetupUntilTheHostStops = definePlugin({
      name: 'test/sandbox-setup-until-the-host-stops',
      setup: () => {
        const setup: ChatMiddleware<HarnessRunContext> = {
          name: 'test/sandbox-setup-until-the-host-stops',
          onStart: async ({ context }) => {
            setupStarted.resolve(null)
            await once(context.run.signal, 'abort')
          }
        }

        return { middleware: [setup] }
      }
    })
    const starting = await workerSessionOpener({
      plugins: [sandboxSetupUntilTheHostStops]
    })(persistence, surface, [])
    const opened = await starting.threads.open(TASK_7_METADATA)
    await starting.session.updateIndexEntry({
      metadata: { ...TASK_7_METADATA, ...opened }
    })
    await starting.session.send('Do the task TASK-7.', { inputId }).receipt
    await setupStarted.promise
    await starting.host.close({ recoverable: true })

    await using restarted = await openWorkerSession(persistence, surface, [
      { text: 'Reading.' }
    ])
    await restarted.session.settled({ inputId })

    expect(posted(calls)).toStrictEqual([
      rootPost(STARTING_LINE),
      threadPost('Reading.')
    ])
  })
})

describe('the first message of a worker thread', () => {
  it('greets with the title of the worker, shows its image, and adds the branch link once the worker has a branch', async () => {
    const persistence = memoryPersistence()
    const { posts, edits, surface } = recordSurface()
    const metadata = { ...TASK_7_METADATA, name: 'Bravo' }

    {
      await using worker = await openWorkerSession(persistence, surface, [
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
    const greeting = `Hi, Release worker Bravo here.\n${STARTING_LINE}`
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

  it('adds the link of a field that the host writes during a turn, at the end of that turn', async () => {
    const pushesTheBranch = definePlugin({
      name: 'test/push-the-branch',
      metadataSchema: workerMetadataSchema,
      setup: (setupContext) => {
        return {
          middleware: [
            {
              name: 'test/push-the-branch',
              onAfterToolCall: async () => {
                await setupContext.session.updateIndexEntry((current) => {
                  return {
                    metadata: {
                      ...TASK_7_METADATA,
                      ...current.metadata,
                      branch: 'task-7-fix'
                    }
                  }
                })
              }
            }
          ]
        }
      }
    })
    const { edits, surface } = recordSurface()
    await using worker = await workerSessionOpener({
      plugins: [pushesTheBranch]
    })(memoryPersistence(), surface, [
      todoWrite([['Push the branch', 'done']]),
      { text: 'Pushed.' }
    ])
    await worker.session.updateIndexEntry({ metadata: TASK_7_METADATA })

    await worker.session.send('Do the task TASK-7.')
    const openingEdit = edits.find(({ messageId }) => {
      return messageId === '1.0001'
    })

    expect(actionsOf(openingEdit?.message)).toStrictEqual([
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
