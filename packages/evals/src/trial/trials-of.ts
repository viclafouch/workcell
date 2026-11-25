import type { EvalCase } from '#/cases/eval-case.ts'

export function trialsOf(cases: readonly EvalCase[], trials: number) {
  return cases.flatMap((evalCase) => {
    return Array.from({ length: trials }, (_, index) => {
      return { name: evalCase.name, trial: index + 1, evalCase }
    })
  })
}
