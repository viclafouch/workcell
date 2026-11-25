type PassRatesParams = {
  trials: number
  passes: number
  k: number
}

function combinations(total: number, chosen: number) {
  if (chosen < 0 || chosen > total) {
    return 0
  }

  let count = 1

  for (let index = 0; index < chosen; index += 1) {
    count = (count * (total - index)) / (index + 1)
  }

  return count
}

export function passRates({ trials, passes, k }: PassRatesParams) {
  if (k > trials) {
    throw new RangeError(`k (${k}) is above the ${trials} trials.`)
  }

  const draws = combinations(trials, k)

  return {
    passAtK: 1 - combinations(trials - passes, k) / draws,
    passPowerK: combinations(passes, k) / draws
  }
}
