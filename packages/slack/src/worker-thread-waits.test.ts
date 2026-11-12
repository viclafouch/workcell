import { describe, expect, it } from 'vitest'
import { memoryPersistence } from '@tanstack/ai-persistence'
import {
  APPROVAL_TEXT,
  ASK_TO_DEPLOY,
  ASK_TO_RUN,
  COLLEAGUE,
  DEPLOY_PREVIEW,
  GO_ON_TEXT,
  OPENING,
  OPENING_LINE,
  STARTED_WORKER,
  STARTER,
  TASK_7_METADATA,
  WORKER_THREAD,
  createTestThreads,
  firstWaitId,
  openLimitedWorkerSession,
  openWorkerSession,
  recordSlack,
  recordWorkers,
  rootPost
} from './worker-thread-fixtures.ts'

const POSTS_OF_AN_APPROVED_TURN = 3

const CONFIRM_TEXT_MAX_LENGTH = 300

describe('the questions of a worker thread', () => {
  it('shows the header of a question and the description of each option', async () => {
    const { posts, web } = recordSlack()
    await using worker = await openWorkerSession(memoryPersistence(), web, [
      OPENING,
      {
        toolCalls: [
          {
            name: 'question',
            input: {
              questions: [
                {
                  header: 'Base',
                  question: 'Which branch does the pull request target?',
                  options: [
                    { label: 'dev', description: 'the default branch' },
                    { label: 'main' }
                  ]
                }
              ]
            }
          }
        ]
      }
    ])
    await worker.session.updateIndexEntry({ metadata: TASK_7_METADATA })
    await worker.session.send('Do the task TASK-7.')

    expect(posts[1]).toMatchObject({
      markdown: [
        'Base: Which branch does the pull request target?',
        '1. dev - the default branch',
        '2. main'
      ].join('\n')
    })
  })
})

describe('the budget stop of a worker thread', () => {
  it('posts once the question of a turn that stops at its budget, on a wake after a restart', async () => {
    const persistence = memoryPersistence()
    const { calls, web } = recordSlack()

    {
      await using worker = await openWorkerSession(persistence, web, [
        OPENING,
        { text: 'I look.' }
      ])
      await worker.session.updateIndexEntry({ metadata: TASK_7_METADATA })
      await worker.session.send('Do the task TASK-7.')
    }

    await using restarted = await openLimitedWorkerSession(persistence, web, [
      { text: 'Never asked.' }
    ])
    await restarted.session.send('Go on.')

    expect(restarted.session.snapshot().pendingWaits).toMatchObject([
      { kind: 'human' }
    ])
    expect(
      calls.filter((call) => {
        return call.includes(' post ')
      })
    ).toStrictEqual([
      rootPost(OPENING_LINE),
      'Alpha https://images.example.com/alpha.png post 1.0001: I look.',
      `Alpha https://images.example.com/alpha.png post 1.0001: ${GO_ON_TEXT}`
    ])
  })
})

describe('the approvals of a worker thread', () => {
  it('posts each approval once, with Approve behind a confirmation, Reject, and the slack_approval metadata, also after a restart', async () => {
    const persistence = memoryPersistence()
    const { calls, posts, web } = recordSlack()

    {
      await using worker = await openWorkerSession(persistence, web, [
        OPENING,
        ASK_TO_DEPLOY
      ])
      await worker.session.updateIndexEntry({ metadata: TASK_7_METADATA })
      await worker.session.send('Deploy a preview.')
    }

    await using restarted = await openWorkerSession(persistence, web, [
      { text: 'preview online' }
    ])
    const waitId = firstWaitId(restarted.session.snapshot().pendingWaits)
    const [approval] = posts.slice(1)
    await restarted.session.resolve({
      inputId: 'approval:1',
      resume: [{ interruptId: waitId, status: 'resolved', payload: 'once' }]
    })
    await restarted.session.settled({ inputId: 'approval:1' })
    const visibleToUserIds = [STARTER]

    expect(posts).toHaveLength(POSTS_OF_AN_APPROVED_TURN)
    expect(approval).toStrictEqual({
      ...WORKER_THREAD,
      identity: {
        username: 'Alpha',
        icon: { url: 'https://images.example.com/alpha.png' }
      },
      text: APPROVAL_TEXT,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: APPROVAL_TEXT } },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              action_id: 'worker_approval_once',
              text: { type: 'plain_text', text: 'Approve' },
              style: 'primary',
              value: waitId,
              visible_to_user_ids: visibleToUserIds,
              confirm: {
                title: { type: 'plain_text', text: 'Approve?' },
                text: { type: 'plain_text', text: DEPLOY_PREVIEW },
                confirm: { type: 'plain_text', text: 'Approve' },
                deny: { type: 'plain_text', text: 'Cancel' }
              }
            },
            {
              type: 'button',
              action_id: 'worker_approval_reject',
              text: { type: 'plain_text', text: 'Reject' },
              style: 'danger',
              value: waitId,
              visible_to_user_ids: visibleToUserIds
            }
          ]
        }
      ],
      metadata: {
        event_type: 'slack_approval',
        event_payload: {
          approval_type: 'tool_use',
          title: `Alpha: ${DEPLOY_PREVIEW}`,
          source: { ref_id: waitId },
          urgency: 'normal',
          options: { approve_label: 'Approve', deny_label: 'Reject' }
        }
      }
    })
    expect(calls.at(-1)).toBe(
      'Alpha https://images.example.com/alpha.png post 1.0001: preview online'
    )
  })

  it('posts the approval that the turn asks for after a person answered the first one, also after a restart', async () => {
    const persistence = memoryPersistence()
    const { posts, web } = recordSlack()

    {
      await using worker = await openWorkerSession(persistence, web, [
        OPENING,
        ASK_TO_DEPLOY
      ])
      await worker.session.updateIndexEntry({ metadata: TASK_7_METADATA })
      await worker.session.send('Deploy a preview.')
    }

    await using restarted = await openWorkerSession(persistence, web, [
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
    expect(posts.at(-1)).toMatchObject({
      text: 'May I run this?\n```\nnpm view react version\n```'
    })
  })

  it('answers an approval of an allowed starter, writes the decision and its author on the message, and leaves a colleague alone', async () => {
    const { calls, web } = recordSlack()
    const recorded = recordWorkers()
    const told: string[] = []
    const route = createTestThreads(web).routes({
      liveWorkers: () => {
        return [STARTED_WORKER]
      },
      workers: recorded.workers
    })(WORKER_THREAD)
    const click = {
      waitId: 'wait-1',
      ts: '3.0001',
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
    expect(told).toStrictEqual(['This approval is settled already.'])
  })

  it('shows the whole command of a call longer than the TanStack preview', async () => {
    const command = `pnpm exec vitest run ${Array.from(
      { length: 40 },
      (_, index) => {
        return `src/features/area-${index}/area.test.ts`
      }
    ).join(' ')}`
    const { posts, web } = recordSlack()
    await using worker = await openWorkerSession(memoryPersistence(), web, [
      OPENING,
      { toolCalls: [{ name: 'run', input: { command } }] }
    ])
    await worker.session.updateIndexEntry({ metadata: TASK_7_METADATA })
    await worker.session.send('Run the area tests.')

    expect(command.length).toBeGreaterThan(CONFIRM_TEXT_MAX_LENGTH)
    expect(posts[1]).toMatchObject({
      text: `May I run this?\n\`\`\`\n${command}\n\`\`\``
    })
  })

  it('shows the command alone for a call with a command, in the message and in the confirmation', async () => {
    const { posts, web } = recordSlack()
    await using worker = await openWorkerSession(memoryPersistence(), web, [
      OPENING,
      ASK_TO_RUN
    ])
    await worker.session.updateIndexEntry({ metadata: TASK_7_METADATA })
    await worker.session.send('Give me the React version.')

    expect(posts[1]).toMatchObject({
      text: 'May I run this?\n```\nnpm view react version\n```',
      blocks: [
        {},
        {
          elements: [
            {
              confirm: {
                text: { type: 'plain_text', text: 'npm view react version' }
              }
            },
            {}
          ]
        }
      ]
    })
  })
})
