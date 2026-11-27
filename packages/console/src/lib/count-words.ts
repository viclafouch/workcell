const pluralRules = new Intl.PluralRules('en')

const counts = new Intl.NumberFormat('en')

export const formatCount = (count: number) => {
  return counts.format(count)
}

export const countOf = (count: number, one: string, other: string) => {
  return `${formatCount(count)} ${pluralRules.select(count) === 'one' ? one : other}`
}
