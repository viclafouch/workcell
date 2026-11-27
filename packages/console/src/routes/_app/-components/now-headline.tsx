import type { WorkerView } from '@workcell/core'
import { countWord } from '#/lib/count-words.ts'

const workSentence = (count: number) => {
  if (count === 0) {
    return 'Nothing runs right now.'
  }

  return count === 1
    ? 'One worker is working.'
    : `${countWord(count)} workers are working.`
}

const listFormat = new Intl.ListFormat('en', { type: 'conjunction' })

const restSentence = (
  needsYou: readonly WorkerView[],
  asleep: readonly WorkerView[]
) => {
  if (needsYou.length > 0) {
    const names = needsYou.map(({ name }) => {
      return name
    })

    return `${listFormat.format(names)} ${names.length === 1 ? 'waits' : 'wait'} for you.`
  }

  if (asleep.length === 0) {
    return 'Nobody waits for you.'
  }

  return asleep.length === 1
    ? 'One worker sleeps until a message wakes it.'
    : `${countWord(asleep.length)} workers sleep until a message wakes them.`
}

type NowHeadlineProps = {
  working: readonly WorkerView[]
  needsYou: readonly WorkerView[]
  asleep: readonly WorkerView[]
}

export const NowHeadline = ({
  working,
  needsYou,
  asleep
}: NowHeadlineProps) => {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-3xl leading-tight font-semibold sm:text-4xl">
        {workSentence(working.length)}
      </h1>
      <p
        data-status={needsYou.length === 0 ? 'idle' : 'waiting'}
        className="text-lg text-status"
      >
        {restSentence(needsYou, asleep)}
      </p>
    </div>
  )
}
