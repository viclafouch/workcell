import { describe, expect, it } from 'vitest'
import { passRates } from '#/report/pass-at-k.ts'

describe('passRates', () => {
  it('reads two passes out of five trials as a pass@2 of 0.7 and a pass^2 of 0.1', () => {
    expect(passRates({ trials: 5, passes: 2, k: 2 })).toStrictEqual({
      passAtK: 0.7,
      passPowerK: 0.1
    })
  })

  it('reads every trial passing as certain on both sides', () => {
    expect(passRates({ trials: 3, passes: 3, k: 3 })).toStrictEqual({
      passAtK: 1,
      passPowerK: 1
    })
  })

  it('reads one pass out of three, with k at three, as possible but not reliable', () => {
    expect(passRates({ trials: 3, passes: 1, k: 3 })).toStrictEqual({
      passAtK: 1,
      passPowerK: 0
    })
  })

  it('reads no pass as zero on both sides', () => {
    expect(passRates({ trials: 4, passes: 0, k: 2 })).toStrictEqual({
      passAtK: 0,
      passPowerK: 0
    })
  })

  it('refuses a k above the number of trials', () => {
    expect(() => {
      return passRates({ trials: 2, passes: 1, k: 3 })
    }).toThrow('k (3) is above the 2 trials')
  })
})
