import { useSuspenseQuery } from '@tanstack/react-query'
import type { WorkerView } from '@workcell/core'
import { getCapacityQueryOpts } from '#/queries/workers.ts'

const placesSentence = (taken: number, capacity: number) => {
  if (taken >= capacity) {
    return capacity === 1
      ? 'The one place is taken: the next task starts once this one ends.'
      : `All ${capacity} places are taken: the next task starts once one ends.`
  }

  return `${taken} of ${capacity} places taken.`
}

type PlacesLineProps = {
  workers: readonly WorkerView[]
}

export const PlacesLine = ({ workers }: PlacesLineProps) => {
  const capacityQuery = useSuspenseQuery(getCapacityQueryOpts())
  const taken = workers.filter(({ phase }) => {
    return phase !== 'finished'
  }).length
  const ranks = Array.from({ length: capacityQuery.data }, (_, rank) => {
    return rank
  })

  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
      <span aria-hidden className="flex flex-wrap items-center gap-1.5">
        {ranks.map((rank) => {
          const isTaken = rank < taken

          return (
            <span
              key={rank}
              data-status={isTaken ? 'running' : 'idle'}
              data-taken={isTaken ? '' : undefined}
              className="place-pip"
            />
          )
        })}
      </span>
      <span className="tabular">
        {placesSentence(taken, capacityQuery.data)}
      </span>
    </p>
  )
}
