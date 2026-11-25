import {
  createJudge,
  createJudgeHarness,
  type JsonValue,
  type JudgeHarness
} from 'vitest-evals'
import { boolean, decide, type AnyEvaluateAdapter } from '@tanstack/ai'
import type { EvalCase } from '#/cases/eval-case.ts'
import { InfrastructureError } from '#/trial/infrastructure-error.ts'
import type { TrialOutput } from '#/trial/worker-harness.ts'

const VERDICT = 'verdict'

export const MERGED_CHANGE_RUBRIC =
  'A person merged `merged` to solve `task`. Does `trial` solve the task as well as `merged` on what tests cannot check: the same scope, no unrelated edit, and names and structure a reviewer of this repository would accept? A different but equally good change counts as yes.'

function probabilityOf(verdict: JsonValue | undefined) {
  if (
    typeof verdict === 'object' &&
    verdict !== null &&
    !Array.isArray(verdict) &&
    typeof verdict.probability === 'number'
  ) {
    return verdict.probability
  }

  throw new Error('The judge harness answered with no probability.')
}

export function decideJudgeHarness(adapter: AnyEvaluateAdapter): JudgeHarness {
  return createJudgeHarness({
    name: `decide:${adapter.name}/${adapter.model}`,
    run: async ({ system, prompt }, { signal }) => {
      const result = await decide({
        adapter,
        state: prompt,
        questions: {
          [VERDICT]: boolean({ instructions: system ?? MERGED_CHANGE_RUBRIC })
        },
        abortSignal: signal
      }).catch((error: unknown) => {
        throw new InfrastructureError('The judge did not answer.', {
          cause: error
        })
      })
      const { probability } = result[VERDICT]
      const { usage } = result.meta

      return {
        output: { probability },
        session: {
          events: [
            { type: 'message', role: 'user', content: prompt },
            { type: 'message', role: 'assistant', content: { probability } }
          ]
        },
        usage: {
          provider: adapter.name,
          model: result.meta.model,
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          ...(usage.cost === undefined ? {} : { costUsd: usage.cost })
        },
        errors: []
      }
    }
  })
}

type MergedChangeJudgeParams = {
  judgeHarness?: JudgeHarness
  rubric?: string
}

export function mergedChangeJudge({
  judgeHarness,
  rubric = MERGED_CHANGE_RUBRIC
}: MergedChangeJudgeParams = {}) {
  return createJudge<EvalCase, TrialOutput>({
    name: 'MergedChangeJudge',
    judgeHarness,
    assess: async ({ input, output, runJudge }) => {
      if (runJudge === undefined) {
        throw new Error('MergedChangeJudge needs a judge harness.')
      }

      const verdict = await runJudge({
        system: rubric,
        prompt: JSON.stringify({
          task: input.instruction,
          merged: input.solution,
          trial: output.diff
        })
      })

      return { score: probabilityOf(verdict) }
    }
  })
}
