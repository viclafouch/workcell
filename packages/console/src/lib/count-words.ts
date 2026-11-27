const NUMBER_WORDS = [
  'No',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine'
]

export const countWord = (count: number) => {
  return NUMBER_WORDS[count] ?? String(count)
}
