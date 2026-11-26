import type { WorkerView } from '@workcell/core'

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

const countWord = (count: number) => {
  return NUMBER_WORDS[count] ?? String(count)
}

const workSentence = (count: number) => {
  return count === 1
    ? 'One worker is on a task.'
    : `${countWord(count)} workers are on a task.`
}

const listFormat = new Intl.ListFormat('en', { type: 'conjunction' })

const waitSentence = (names: readonly string[]) => {
  if (names.length === 0) {
    return 'None of them waits for you.'
  }

  return `${listFormat.format(names)} ${names.length === 1 ? 'waits' : 'wait'} for you.`
}

type NowHeadlineProps = {
  workers: readonly WorkerView[]
}

export const NowHeadline = ({ workers }: NowHeadlineProps) => {
  const waiting = workers.filter(({ phase, waits }) => {
    return phase === 'waiting' || waits.length > 0
  })

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-3xl leading-tight font-semibold sm:text-4xl">
        {workSentence(workers.length)}
      </h1>
      <p
        data-status={waiting.length === 0 ? 'idle' : 'waiting'}
        className="text-lg text-status"
      >
        {waitSentence(
          waiting.map(({ name }) => {
            return name
          })
        )}
      </p>
    </div>
  )
}
