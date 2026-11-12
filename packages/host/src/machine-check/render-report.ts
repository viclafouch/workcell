import { styleText } from 'node:util'
import type { CheckResult } from './check-result.ts'
import type { MachineCommands } from './machine-commands.ts'

type CheckGroup = {
  title: string
  results: CheckResult[]
}

type ReportOptions = {
  commands: Pick<MachineCommands, 'check'>
}

const FIX_GAP = '   '

function renderResult(result: CheckResult, labelWidth: number) {
  if (result.ok) {
    return `    ${styleText('green', '✔')} ${result.label}`
  }

  return `    ${styleText('red', '✘')} ${result.label.padEnd(labelWidth)}${FIX_GAP}${styleText('cyan', result.fix)}`
}

function renderSummary(results: CheckResult[], checkCommand: string) {
  const failedCount = results.filter(({ ok }) => {
    return !ok
  }).length

  if (failedCount === 0) {
    return styleText(
      ['bold', 'green'],
      `All ${results.length} checks pass. This machine can build and run the sandbox.`
    )
  }

  return `${styleText(['bold', 'red'], `${failedCount} of ${results.length} checks fail.`)} Run the fix next to each ✘, then ${styleText('cyan', checkCommand)} again.`
}

export function renderReport(
  groups: CheckGroup[],
  { commands }: ReportOptions
) {
  const results = groups.flatMap(({ results: groupResults }) => {
    return groupResults
  })
  const labelWidth = Math.max(
    ...results.map(({ label }) => {
      return label.length
    })
  )
  const groupBlocks = groups.map(({ title, results: groupResults }) => {
    return [
      `  ${styleText('bold', title)}`,
      ...groupResults.map((result) => {
        return renderResult(result, labelWidth)
      })
    ].join('\n')
  })

  return `\n${[...groupBlocks, `  ${renderSummary(results, commands.check)}`].join('\n\n')}\n`
}
