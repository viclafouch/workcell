const usd = new Intl.NumberFormat('en', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2
})

export const formatUsd = (amount: number) => {
  return Number.isFinite(amount) ? usd.format(amount) : 'Not known'
}
