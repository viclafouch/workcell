import { describe, expect, vi } from 'vitest'
import { createHarness, describeEval } from 'vitest-evals'
import type { EvaluateAdapter } from '@tanstack/ai'
import { verifierScript, type EvalCase } from '#/cases/eval-case.ts'
import {
  decideJudgeHarness,
  mergedChangeJudge
} from '#/judge/merged-change-judge.ts'
import type { TrialOutput } from '#/trial/worker-harness.ts'

type EvaluateOptions = Parameters<EvaluateAdapter['evaluate']>[0]

const LIKELY_YES = 0.9

const LIKELY_NO = 0.2

const MERGED_DIFF = '-hello\n+hi\n'

const TRIAL_DIFF = '-hello\n+hi there\n'

const SAY_HI: EvalCase = {
  name: 'say-hi',
  instruction: 'Change the greeting to hi.\n',
  repository: 'acme/app',
  baseCommit: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
  pullRequest: 'https://github.com/acme/app/pull/1',
  threadId: 'thread-of-the-task',
  outcome: { value: 'flawed', costUsd: 1 },
  solution: MERGED_DIFF,
  verifier: verifierScript('true')
}

function fakeDecider(probabilityOfYes: number) {
  const asked: EvaluateOptions[] = []
  const adapter: EvaluateAdapter = {
    kind: 'evaluate',
    name: 'fake',
    model: 'fake-judge',
    '~types': { providerOptions: {} },
    evaluate: async (options) => {
      asked.push(options)

      return {
        model: 'fake-judge',
        answers: Object.fromEntries(
          Object.keys(options.questions).map((key) => {
            return [key, { type: 'noul', noul: probabilityOfYes }]
          })
        ),
        usage: { promptTokens: 120, completionTokens: 1, totalTokens: 121 }
      }
    }
  }

  return { adapter, asked }
}

const trialHarness = createHarness<EvalCase, TrialOutput>({
  name: 'fixed-trial',
  run: ({ input }) => {
    return {
      output: { reward: 1, diff: TRIAL_DIFF },
      events: [{ type: 'message', role: 'user', content: input.instruction }]
    }
  }
})

function unreachableDecider(): EvaluateAdapter {
  return {
    ...fakeDecider(LIKELY_YES).adapter,
    evaluate: async () => {
      throw new TypeError('fetch failed')
    }
  }
}

describe('the merged change judge', () => {
  const close = fakeDecider(LIKELY_YES)

  describeEval(
    'a trial the judge finds as good as the merged change',
    { harness: trialHarness },
    (it) => {
      it('satisfies the judge at its threshold', async ({ run }) => {
        const result = await run(SAY_HI)

        await expect(result).toSatisfyJudge(
          mergedChangeJudge({
            judgeHarness: decideJudgeHarness(close.adapter)
          }),
          { threshold: 0.8 }
        )
      })

      it('shows the judge the task, the merged change and the trial diff', async ({
        run
      }) => {
        const result = await run(SAY_HI)
        await expect(result).toSatisfyJudge(
          mergedChangeJudge({
            judgeHarness: decideJudgeHarness(close.adapter)
          }),
          { threshold: null }
        )

        expect(close.asked.at(-1)?.state).toBe(
          JSON.stringify({
            task: SAY_HI.instruction,
            merged: MERGED_DIFF,
            trial: TRIAL_DIFF
          })
        )
      })
    }
  )

  describeEval(
    'a trial whose judge does not answer',
    { harness: trialHarness },
    (it) => {
      it('fails as infrastructure noise, apart from a model failure', async ({
        run
      }) => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const result = await run(SAY_HI)

        await expect(
          expect(result).toSatisfyJudge(
            mergedChangeJudge({
              judgeHarness: decideJudgeHarness(unreachableDecider())
            }),
            { threshold: 0.8 }
          )
        ).rejects.toMatchObject({ name: 'InfrastructureError' })
      })
    }
  )

  const far = fakeDecider(LIKELY_NO)

  describeEval(
    'a trial the judge finds far from the merged change',
    { harness: trialHarness },
    (it) => {
      it('fails the judge', async ({ run }) => {
        const result = await run(SAY_HI)

        await expect(
          expect(result).toSatisfyJudge(
            mergedChangeJudge({
              judgeHarness: decideJudgeHarness(far.adapter)
            }),
            { threshold: 0.8 }
          )
        ).rejects.toThrow('below threshold')
      })
    }
  )
})
