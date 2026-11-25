import { describe, expect, it } from 'vitest'
import { memoryPersistence } from '@tanstack/ai-persistence'
import {
  ALPHA,
  APPROVAL_TEXT,
  ASK_TO_DEPLOY,
  ASK_TO_RUN,
  COLLEAGUE,
  GO_ON_TEXT,
  STARTING_LINE,
  STARTED_WORKER,
  STARTER,
  TASK_7_METADATA,
  WORKER_THREAD,
  actionsOf,
  createTestThreads,
  firstWaitId,
  openLimitedWorkerSession,
  openWorkerSession,
  posted,
  recordSurface,
  recordWorkers,
  rootPost,
  postText,
  threadPost
} from './worker-thread-fixtures.ts'

const POSTS_OF_AN_APPROVED_TURN = 3

const TANSTACK_PREVIEW_MAX_LENGTH = 300

describe('the budget stop of a worker thread', () => {
  it('posts once the question of a turn that stops at its budget, on a wake after a restart', async () => {
    const persistence = memoryPersistence()
    const { calls, surface } = recordSurface()

    {
      await using worker = await openWorkerSession(persistence, surface, [
        { text: 'I look.' }
      ])
      await worker.session.updateIndexEntry({ metadata: TASK_7_METADATA })
      await worker.session.send('Do the task TASK-7.')
    }

    await using restarted = await openLimitedWorkerSession(
      persistence,
      surface,
      [{ text: 'Never asked.' }]
    )
    await restarted.session.send('Go on.')

    expect(restarted.session.snapshot().pendingWaits).toMatchObject([
      { kind: 'human' }
    ])
    expect(posted(calls)).toStrictEqual([
      rootPost(STARTING_LINE),
      threadPost('I look.'),
      threadPost(GO_ON_TEXT)
    ])
  })
})

describe('the approvals of a worker thread', () => {
  it('posts each approval once, with Approve and Reject for the allowed starters, also after a restart', async () => {
    const persistence = memoryPersistence()
    const { calls, posts, surface } = recordSurface()

    {
      await using worker = await openWorkerSession(persistence, surface, [
        ASK_TO_DEPLOY
      ])
      await worker.session.updateIndexEntry({ metadata: TASK_7_METADATA })
      await worker.session.send('Deploy a preview.')
    }

    await using restarted = await openWorkerSession(persistence, surface, [
      { text: 'preview online' }
    ])
    const waitId = firstWaitId(restarted.session.snapshot().pendingWaits)
    const [, approval] = posts
    await restarted.session.resolve({
      inputId: 'approval:1',
      resume: [{ interruptId: waitId, status: 'resolved', payload: 'once' }]
    })
    await restarted.session.settled({ inputId: 'approval:1' })

    expect(posts).toHaveLength(POSTS_OF_AN_APPROVED_TURN)
    expect(approval).toMatchObject({
      target: { threadId: WORKER_THREAD },
      identity: ALPHA,
      message: {
        fallbackText: APPROVAL_TEXT,
        card: { children: [{ type: 'text', content: APPROVAL_TEXT }, {}] }
      }
    })
    expect(actionsOf(approval?.message)).toStrictEqual([
      {
        type: 'button',
        id: 'worker_approval_once',
        label: 'Approve',
        style: 'primary',
        value: waitId,
        visibleTo: [STARTER]
      },
      {
        type: 'button',
        id: 'worker_approval_reject',
        label: 'Reject',
        style: 'danger',
        value: waitId,
        visibleTo: [STARTER]
      }
    ])
    expect(calls.at(-1)).toBe(threadPost('preview online'))
  })

  it('posts the approval that the turn asks for after a person answered the first one, also after a restart', async () => {
    const persistence = memoryPersistence()
    const { posts, surface } = recordSurface()

    {
      await using worker = await openWorkerSession(persistence, surface, [
        ASK_TO_DEPLOY
      ])
      await worker.session.updateIndexEntry({ metadata: TASK_7_METADATA })
      await worker.session.send('Deploy a preview.')
    }

    await using restarted = await openWorkerSession(persistence, surface, [
      ASK_TO_RUN
    ])
    await restarted.session.resolve({
      inputId: 'approval:1',
      resume: [
        {
          interruptId: firstWaitId(restarted.session.snapshot().pendingWaits),
          status: 'resolved',
          payload: 'once'
        }
      ]
    })
    await restarted.session.settled({ inputId: 'approval:1' })
    expect(restarted.session.snapshot().pendingWaits).toHaveLength(1)
    expect(posts.map(postText).at(-1)).toBe(
      'May I run this?\n```\nnpm view react version\n```'
    )
  })

  it('answers an approval of an allowed starter once, writes the decision and its author on the message, and leaves a colleague alone', async () => {
    const { calls, edits, surface } = recordSurface()
    const recorded = recordWorkers()
    const told: string[] = []
    const route = createTestThreads(surface).routes({
      liveWorkers: () => {
        return [STARTED_WORKER]
      },
      workers: recorded.workers
    })(WORKER_THREAD)
    const click = {
      waitId: 'wait-1',
      messageId: '3.0001',
      asked: APPROVAL_TEXT,
      tell: async (text: string) => {
        told.push(text)
      }
    }

    await route?.approve({ ...click, user: COLLEAGUE, answer: 'once' })
    await route?.approve({ ...click, user: STARTER, answer: 'once' })
    await route?.approve({ ...click, user: STARTER, answer: 'reject' })

    expect(recorded.approvals).toStrictEqual([
      {
        threadId: STARTED_WORKER.threadId,
        waitId: 'wait-1',
        approver: { id: STARTER },
        answer: 'once'
      },
      {
        threadId: STARTED_WORKER.threadId,
        waitId: 'wait-1',
        approver: { id: STARTER },
        answer: 'reject'
      }
    ])
    expect(calls).toStrictEqual([
      `edit 3.0001: ${APPROVAL_TEXT}\n<@${STARTER}> approved`
    ])
    expect(edits[0]).toMatchObject({
      threadId: WORKER_THREAD,
      message: {
        card: {
          children: [
            { type: 'text', content: APPROVAL_TEXT },
            { type: 'text', content: `<@${STARTER}> approved`, style: 'muted' }
          ]
        }
      }
    })
    expect(actionsOf(edits[0]?.message)).toStrictEqual([])
    expect(told).toStrictEqual(['This approval is settled already.'])
  })

  it('shows the whole command of a call longer than the TanStack preview', async () => {
    const command = `pnpm exec vitest run ${Array.from(
      { length: 40 },
      (_, index) => {
        return `src/features/area-${index}/area.test.ts`
      }
    ).join(' ')}`
    const { posts, surface } = recordSurface()
    await using worker = await openWorkerSession(memoryPersistence(), surface, [
      { toolCalls: [{ name: 'run', input: { command } }] }
    ])
    await worker.session.updateIndexEntry({ metadata: TASK_7_METADATA })
    await worker.session.send('Run the area tests.')
    expect(command.length).toBeGreaterThan(TANSTACK_PREVIEW_MAX_LENGTH)
    expect(posts.map(postText)[1]).toBe(
      `May I run this?\n\`\`\`\n${command}\n\`\`\``
    )
  })
})
