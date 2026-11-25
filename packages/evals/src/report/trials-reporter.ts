import type { Reporter, TestCase, TestModule, Vitest } from 'vitest/node'
import type { EvalCase } from '#/cases/eval-case.ts'
import { CASE_ARTIFACT } from '#/trial/case-artifact.ts'
import {
  costEstimate,
  formatTrialReport,
  summarizeTrials,
  trialStatusOf,
  type Trial
} from './trial-report.ts'

type TrialsReporterParams = {
  cases: readonly EvalCase[]
  trials: number
  models: readonly string[]
}

const ENGLISH_PLURALS = new Intl.PluralRules('en')

function counted(count: number, noun: string) {
  return `${count} ${ENGLISH_PLURALS.select(count) === 'one' ? noun : `${noun}s`}`
}

function trialOf(testCase: TestCase): Trial | undefined {
  const { harness } = testCase.meta()
  const caseName = harness?.run.artifacts?.[CASE_ARTIFACT]
  const result = testCase.result()

  if (
    harness === undefined ||
    typeof caseName !== 'string' ||
    (result.state !== 'passed' && result.state !== 'failed')
  ) {
    return undefined
  }

  return {
    model: harness.name,
    caseName,
    status: trialStatusOf(result.errors ?? []),
    costUsd: harness.run.usage.costUsd,
    totalMs: harness.run.timings?.totalMs
  }
}

export function trialsReporter({
  cases,
  trials,
  models
}: TrialsReporterParams): Reporter {
  let logger: Vitest['logger'] | null = null

  const log = (message: string) => {
    logger?.log(message)
  }

  return {
    onInit: (vitest) => {
      ;({ logger } = vitest)
    },
    onTestRunStart: () => {
      const estimateUsd = costEstimate({
        taskCostsUsd: cases.map(({ outcome }) => {
          return outcome.costUsd
        }),
        trials,
        models: models.length
      })
      log(
        `Eval set: ${counted(cases.length, 'case')} × ${counted(trials, 'trial')} × ${counted(models.length, 'model')}, about $${estimateUsd.toFixed(2)} at the cost of the tasks they come from.`
      )
    },
    onTestRunEnd: (testModules: readonly TestModule[]) => {
      const ran = testModules.flatMap((testModule) => {
        return [...testModule.children.allTests()].flatMap((testCase) => {
          return trialOf(testCase) ?? []
        })
      })
      log(`\n${formatTrialReport(summarizeTrials(ran))}`)
    }
  }
}
