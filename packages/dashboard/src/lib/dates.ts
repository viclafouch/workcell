const dateTime = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

export const formatDateTime = (value: string | number) => {
  return dateTime.format(new Date(value))
}
