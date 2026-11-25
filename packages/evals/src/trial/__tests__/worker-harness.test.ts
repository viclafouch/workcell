import { afterAll, beforeAll, describe, expect } from 'vitest'
import { describeEval, type TranscriptEvent } from 'vitest-evals'
import type { FakeResponseStep } from '@tanstack/ai/testing'
import { createMigratedDatabase, TEST_STARTER } from '@workcell/core/testing'
import { verifierScript } from '#/cases/eval-case.ts'
import { workerHarness } from '#/trial/worker-harness.ts'
import {
  createOrigin,
  greetingCase,
  openTrialTestbed
} from './trial-workcell.ts'

const SAY_HI_VERIFIER = verifierScript('grep -qx hi greeting.txt')

function bash(command: string): FakeResponseStep {
  return { toolCalls: [{ name: 'bash', input: { command } }] }
}

const REPORT: FakeResponseStep = { text: 'The greeting says hi.' }

function lastToolResultOf(events: readonly TranscriptEvent[]) {
  const results = events.filter((event) => {
    return event.type === 'tool_result'
  })

  return JSON.stringify(results.at(-1)?.content)
}

function trialRefusalsOf(events: readonly TranscriptEvent[]) {
  return events.filter((event) => {
    return (
      event.type === 'tool_result' &&
      JSON.stringify(event.content).includes('a trial of the eval set')
    )
  })
}

let testbed: Awaited<ReturnType<typeof openTrialTestbed>>
let origin: Awaited<ReturnType<typeof createOrigin>>

function harnessAnswering(responses: FakeResponseStep[]) {
  return workerHarness({
    name: 'fake-model',
    starter: TEST_STARTER,
    sandboxAt: () => {
      return testbed.sandboxAt(origin.url)
    },
    openWorkcell: async (trial) => {
      return testbed.openTrialWorkcell(responses)(trial)
    }
  })
}

describe('a trial of the eval set', () => {
  beforeAll(async () => {
    testbed = await openTrialTestbed(await createMigratedDatabase())
    origin = await createOrigin()
  })

  afterAll(async () => {
    await origin[Symbol.asyncDispose]()
    await testbed[Symbol.asyncDispose]()
  })

  describeEval(
    'a trial that solves its task',
    {
      harness: harnessAnswering([bash("printf 'hi\\n' > greeting.txt"), REPORT])
    },
    (it) => {
      it('starts at the base commit, and earns the reward of its verifier', async ({
        run
      }) => {
        const result = await run(
          greetingCase(origin.baseCommit, SAY_HI_VERIFIER)
        )

        expect(result.output?.reward).toBe(1)
        expect(result.output?.diff).toContain('-hello\n+hi')
      })
    }
  )

  describeEval(
    'a trial that leaves the task undone',
    {
      harness: harnessAnswering([{ text: 'I could not do it.' }])
    },
    (it) => {
      it('earns no reward', async ({ run }) => {
        const result = await run(
          greetingCase(origin.baseCommit, SAY_HI_VERIFIER)
        )

        expect(result.output).toStrictEqual({ reward: 0, diff: '' })
      })
    }
  )

  describeEval(
    'a trial that tries to reach the merged answer',
    {
      harness: harnessAnswering([
        bash('git fetch origin main'),
        bash('git push origin HEAD:refs/heads/trial'),
        REPORT
      ])
    },
    (it) => {
      it('gets the fetch and the push refused', async ({ run }) => {
        const result = await run(
          greetingCase(origin.baseCommit, SAY_HI_VERIFIER)
        )

        expect(trialRefusalsOf(result.session.events)).toHaveLength(2)
        expect(origin.branches()).toStrictEqual(['main'])
      })
    }
  )

  describeEval(
    'a trial that reads the history of its repository',
    {
      harness: harnessAnswering([bash('git log --all --format=%s'), REPORT])
    },
    (it) => {
      it('sees no commit past its base', async ({ run }) => {
        const result = await run(
          greetingCase(origin.baseCommit, SAY_HI_VERIFIER)
        )

        expect(lastToolResultOf(result.session.events)).toContain('Say hello')
        expect(lastToolResultOf(result.session.events)).not.toContain(
          'Say more'
        )
      })
    }
  )

  describeEval(
    'a trial whose verifier writes no reward',
    {
      harness: harnessAnswering([REPORT])
    },
    (it) => {
      it('fails as infrastructure noise, apart from a model failure', async ({
        run
      }) => {
        await expect(
          run(greetingCase(origin.baseCommit, '#!/bin/bash\ntrue\n'))
        ).rejects.toMatchObject({ name: 'InfrastructureError' })
      })
    }
  )
})
