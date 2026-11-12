import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { toolDefinition } from '@tanstack/ai'
import {
  createHarnessHost,
  defineHarness,
  definePlugin,
  type HarnessPlugin
} from '@tanstack/ai-harness'
import { memoryPersistence } from '@tanstack/ai-persistence'
import { fakeText } from '@tanstack/ai/testing'
import type { ModelPricing } from '#core/budget/budget'
import {
  FREE_MODEL_PRICING,
  SILENT_HOST_LOGGER,
  TEST_STARTER
} from './test-doubles.ts'
import { createWorkerActivity, type TurnActivity } from './worker-activity.ts'

const THREAD_ID = 'activity-thread'

const SECRET = 'ghp_activity_secret_value'

const CALL_USD = 0.25

const PRICED_CALLS: ModelPricing = {
  ...FREE_MODEL_PRICING,
  costOfCall: () => {
    return CALL_USD
  }
}

type Seen = { at: string; activity: TurnActivity | undefined }

function bashTool(onRun: () => void) {
  return definePlugin({
    name: 'test/bash',
    setup: () => {
      return {
        tools: [
          toolDefinition({
            name: 'bash',
            description: 'Run a command.',
            inputSchema: z.object({ command: z.string() })
          }).server(() => {
            onRun()

            return 'ok'
          })
        ]
      }
    }
  })
}

async function runTurn(command: string) {
  const activity = createWorkerActivity({
    pricing: PRICED_CALLS,
    secretValues: [SECRET]
  })
  const seen: Seen[] = []
  const see = (at: string) => {
    seen.push({ at, activity: activity.activityOf(THREAD_ID) })
  }
  const seeAtTurnStart: HarnessPlugin = definePlugin({
    name: 'test/see-turn-start',
    setup: () => {
      return {
        onTurnStart: () => {
          see('turn start')
        }
      }
    }
  })
  const model = fakeText()
  model.setResponses([
    () => {
      see('first model call')

      return { toolCalls: [{ name: 'bash', input: { command } }] }
    },
    () => {
      see('second model call')

      return { text: 'Done.' }
    }
  ])
  const host = createHarnessHost({
    persistence: memoryPersistence(),
    logger: SILENT_HOST_LOGGER,
    observability: { onOperation: activity.onOperation }
  })
  const harness = defineHarness({
    name: 'test/activity',
    adapter: model,
    plugins: () => {
      return [
        seeAtTurnStart,
        activity.plugin,
        bashTool(() => {
          see('tool run')
        })
      ]
    }
  })
  const session = await host.open(harness, {
    threadId: THREAD_ID,
    user: TEST_STARTER
  })
  await session.send('Run the command.')
  see('turn end')
  await host.close()

  return seen
}

describe('the activity of a worker', () => {
  it('follows the phase of the turn, its command and its spend', async () => {
    const seen = await runTurn('pnpm turbo run lint\npnpm turbo run test')

    expect(seen).toMatchObject([
      { at: 'turn start', activity: { phase: 'setup', turnUsd: 0 } },
      { at: 'first model call', activity: { phase: 'model', turnUsd: 0 } },
      {
        at: 'tool run',
        activity: {
          phase: 'tool',
          command: 'pnpm turbo run lint',
          turnUsd: CALL_USD
        }
      },
      {
        at: 'second model call',
        activity: { phase: 'model', command: undefined, turnUsd: CALL_USD }
      },
      { at: 'turn end', activity: undefined }
    ])
  })

  it('hides a secret value of the command', async () => {
    const seen = await runTurn(`curl -H "authorization: ${SECRET}" api`)
    const toolRun = seen.find(({ at }) => {
      return at === 'tool run'
    })

    expect(toolRun?.activity?.command).toBe(
      'curl -H "authorization: [redacted]" api'
    )
  })
})
