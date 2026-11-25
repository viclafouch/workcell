import { matchIsInfrastructureError } from '#/trial/infrastructure-error.ts'
import { passRates } from './pass-at-k.ts'

export type Trial = {
  model: string
  caseName: string
  status: 'pass' | 'fail' | 'noise'
  costUsd?: number
  totalMs?: number
}

export type CaseSummary = {
  caseName: string
  model: string
  graded: number
  passes: number
  noise: number
  passAtK: number | undefined
  passPowerK: number | undefined
  costUsd: number
  meanMs: number | undefined
}

const MS_PER_SECOND = 1000

const SECONDS_PER_MINUTE = 60

const COLUMN_GAP = '   '

type TrialError = { name?: string; message: string }

export function trialStatusOf(errors: readonly TrialError[]): Trial['status'] {
  if (errors.length === 0) {
    return 'pass'
  }

  return errors.some(matchIsInfrastructureError) ? 'noise' : 'fail'
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => {
    return total + value
  }, 0)
}

function summaryOf(trials: readonly Trial[]): CaseSummary {
  const [first] = trials

  if (first === undefined) {
    throw new Error('A case summary needs at least one trial.')
  }

  const graded = trials.filter(({ status }) => {
    return status !== 'noise'
  })
  const passes = graded.filter(({ status }) => {
    return status === 'pass'
  }).length
  const rates =
    graded.length === 0
      ? { passAtK: undefined, passPowerK: undefined }
      : passRates({ trials: graded.length, passes, k: graded.length })
  const timed = trials.flatMap(({ totalMs }) => {
    return totalMs === undefined ? [] : [totalMs]
  })

  return {
    caseName: first.caseName,
    model: first.model,
    graded: graded.length,
    passes,
    noise: trials.length - graded.length,
    ...rates,
    costUsd: sum(
      trials.map(({ costUsd = 0 }) => {
        return costUsd
      })
    ),
    meanMs: timed.length === 0 ? undefined : sum(timed) / timed.length
  }
}

export function summarizeTrials(trials: readonly Trial[]) {
  const byCaseAndModel = Map.groupBy(trials, ({ caseName, model }) => {
    return JSON.stringify([caseName, model])
  })

  return [...byCaseAndModel.values()].map(summaryOf)
}

function duration(ms: number | undefined) {
  if (ms === undefined) {
    return '—'
  }

  const seconds = Math.round(ms / MS_PER_SECOND)
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)

  return `${minutes}m${String(seconds % SECONDS_PER_MINUTE).padStart(2, '0')}s`
}

function cellOf(summary: CaseSummary | undefined) {
  if (summary === undefined) {
    return '—'
  }

  const noise = summary.noise === 0 ? '' : `, ${summary.noise} noise`

  if (summary.passAtK === undefined || summary.passPowerK === undefined) {
    return `no graded trial${noise}`
  }

  const { graded } = summary

  return `pass^${graded} ${summary.passPowerK.toFixed(2)} pass@${graded} ${summary.passAtK.toFixed(2)} $${summary.costUsd.toFixed(2)} ${duration(summary.meanMs)}${noise}`
}

export function formatTrialReport(summaries: readonly CaseSummary[]) {
  const models = [
    ...new Set(
      summaries.map(({ model }) => {
        return model
      })
    )
  ]
  const caseNames = [
    ...new Set(
      summaries.map(({ caseName }) => {
        return caseName
      })
    )
  ]
  const header = ['case', ...models]
  const rows = [
    header,
    ...caseNames.map((caseName) => {
      return [
        caseName,
        ...models.map((model) => {
          return cellOf(
            summaries.find((summary) => {
              return summary.caseName === caseName && summary.model === model
            })
          )
        })
      ]
    })
  ]
  const widths = header.map((_, column) => {
    return Math.max(
      ...rows.map((row) => {
        return row[column]?.length ?? 0
      })
    )
  })

  return rows
    .map((row) => {
      return row
        .map((cell, column) => {
          return cell.padEnd(widths[column] ?? 0)
        })
        .join(COLUMN_GAP)
        .trimEnd()
    })
    .join('\n')
}

type CostEstimateParams = {
  taskCostsUsd: readonly number[]
  trials: number
  models: number
}

export function costEstimate({
  taskCostsUsd,
  trials,
  models
}: CostEstimateParams) {
  return sum(taskCostsUsd) * trials * models
}
