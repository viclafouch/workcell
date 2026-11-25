import { describe, expect, it } from 'vitest'
import {
  costEstimate,
  formatTrialReport,
  summarizeTrials,
  trialStatusOf,
  type Trial
} from '#/report/trial-report.ts'

const RENAME_TASK_USD = 1.25

const RETRY_TASK_USD = 0.75

const TWO_TASKS_THREE_TRIALS_TWO_MODELS_USD = 12

function trial(overrides: Partial<Trial>): Trial {
  return {
    model: 'model-a',
    caseName: 'say-hi',
    status: 'pass',
    costUsd: 0.5,
    totalMs: 60_000,
    ...overrides
  }
}

describe('summarizeTrials', () => {
  it('rates each case per model on its graded trials, and keeps the noise apart', () => {
    const [summary] = summarizeTrials([
      trial({ status: 'pass' }),
      trial({ status: 'fail', costUsd: 1.5, totalMs: 120_000 }),
      trial({ status: 'noise', costUsd: undefined, totalMs: undefined })
    ])

    expect(summary).toStrictEqual({
      caseName: 'say-hi',
      model: 'model-a',
      graded: 2,
      passes: 1,
      noise: 1,
      passAtK: 1,
      passPowerK: 0,
      costUsd: 2,
      meanMs: 90_000
    })
  })

  it('leaves the rates out of a case that only met noise', () => {
    const [summary] = summarizeTrials([trial({ status: 'noise' })])

    expect(summary).toMatchObject({
      graded: 0,
      noise: 1,
      passAtK: undefined,
      passPowerK: undefined
    })
  })

  it('keeps two models of one case apart', () => {
    const summaries = summarizeTrials([
      trial({ model: 'model-a', status: 'pass' }),
      trial({ model: 'model-b', status: 'fail' })
    ])

    expect(
      summaries.map(({ model, passes }) => {
        return { model, passes }
      })
    ).toStrictEqual([
      { model: 'model-a', passes: 1 },
      { model: 'model-b', passes: 0 }
    ])
  })
})

describe('formatTrialReport', () => {
  it('puts the models of a case side by side on its line', () => {
    const report = formatTrialReport(
      summarizeTrials([
        trial({ model: 'model-a', status: 'pass' }),
        trial({ model: 'model-b', status: 'fail' }),
        trial({ model: 'model-b', status: 'noise', costUsd: undefined })
      ])
    )
    const [header, line] = report.split('\n')

    expect(header).toMatch(/case\s+model-a\s+model-b/u)
    expect(line).toMatch(
      /say-hi\s+pass\^1 1\.00 pass@1 1\.00 \$0\.50 1m00s\s+pass\^1 0\.00 pass@1 0\.00 \$0\.50 1m00s, 1 noise/u
    )
  })
})

describe('costEstimate', () => {
  it('prices each trial at the cost of the task it comes from', () => {
    expect(
      costEstimate({
        taskCostsUsd: [RENAME_TASK_USD, RETRY_TASK_USD],
        trials: 3,
        models: 2
      })
    ).toBe(TWO_TASKS_THREE_TRIALS_TWO_MODELS_USD)
  })
})

describe('trialStatusOf', () => {
  it('passes a trial with no error', () => {
    expect(trialStatusOf([])).toBe('pass')
  })

  it('fails the model on an assertion or a judge score it did not meet', () => {
    expect(
      trialStatusOf([
        { name: 'AssertionError', message: 'expected 0 to be 1' },
        { name: 'Error', message: 'Score: 0.35 below threshold: 0.50' }
      ])
    ).toBe('fail')
  })

  it('counts an infrastructure error as noise', () => {
    expect(
      trialStatusOf([
        { name: 'InfrastructureError', message: 'The judge did not answer.' }
      ])
    ).toBe('noise')
  })
})
