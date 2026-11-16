import { http, HttpResponse } from 'msw/http'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SILENT_SLACK_LOGGER } from '#/__tests__/test-doubles.ts'
import { createSlackWeb } from '#/connection/slack-web.ts'

const BOT_TOKEN = 'xoxb-test-bot-token'

const STREAM_TS = '100.0002'

const SESSION_TITLE_MAX_LENGTH = 200

const LONG_TITLE_LENGTH = 250

let calls: { method: string; body: Record<string, string> }[]

const network = setupServer(
  http.post('https://slack.com/api/:method', async ({ request, params }) => {
    calls.push({
      method: String(params.method),
      body: Object.fromEntries(new URLSearchParams(await request.text()))
    })

    return HttpResponse.json({ ok: true, ts: STREAM_TS })
  })
)

describe('the Slack stream of an answer', () => {
  beforeAll(() => {
    network.listen({ onUnhandledFrame: 'error' })
  })

  beforeEach(() => {
    calls = []
  })

  afterAll(() => {
    network.close()
  })

  it('starts in the thread for its reader, under the agent name, then appends task cards and text, and stops with a session status', async () => {
    const web = createSlackWeb({
      botToken: BOT_TOKEN,
      logger: SILENT_SLACK_LOGGER
    })
    const stream = web.stream({
      channel: 'C_TEST',
      threadTs: '100.0001',
      recipient: { user: 'U_STARTER', team: 'T_TEAM' }
    })

    await stream.updateTask({
      id: 'call-1',
      title: 'list_workers',
      status: 'in_progress'
    })
    await stream.appendText('Nothing runs.')
    await stream.stop('active')

    expect(calls).toMatchObject([
      {
        method: 'chat.startStream',
        body: {
          channel: 'C_TEST',
          thread_ts: '100.0001',
          recipient_user_id: 'U_STARTER',
          recipient_team_id: 'T_TEAM',
          task_display_mode: 'timeline',
          chunks: JSON.stringify([
            {
              type: 'task_update',
              id: 'call-1',
              title: 'list_workers',
              status: 'in_progress'
            }
          ])
        }
      },
      {
        method: 'chat.stopStream',
        body: {
          channel: 'C_TEST',
          ts: STREAM_TS,
          session_status: 'active',
          chunks: JSON.stringify([
            { type: 'markdown_text', text: 'Nothing runs.' }
          ])
        }
      }
    ])
  })

  it('renames the session of a thread, with a title cut to 200 characters', async () => {
    const web = createSlackWeb({
      botToken: BOT_TOKEN,
      logger: SILENT_SLACK_LOGGER
    })

    await web.rename({
      channel: 'D_TEST',
      threadTs: '100.0001',
      title: 'a'.repeat(LONG_TITLE_LENGTH)
    })

    expect(calls).toStrictEqual([
      {
        method: 'agents.sessions.rename',
        body: {
          channel_id: 'D_TEST',
          thread_ts: '100.0001',
          title: 'a'.repeat(SESSION_TITLE_MAX_LENGTH)
        }
      }
    ])
  })
})
