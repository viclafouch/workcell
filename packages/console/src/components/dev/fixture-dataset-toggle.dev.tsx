import React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group.tsx'
import {
  FIXTURE_DATASET_COOKIE,
  FIXTURE_DATASETS,
  matchIsFixtureDataset,
  type FixtureDataset
} from '#/server/fixture-datasets.ts'

const DATASET_LABELS = {
  demo: 'Demo data',
  worst: 'Worst case',
  empty: 'Empty',
  one: 'One'
} as const satisfies Record<FixtureDataset, string>

const DATASET_PARAM = 'data'

const DATASET_CHANGE = 'workcell:fixture-dataset'

const datasetInUrl = (): FixtureDataset => {
  const value = new URL(window.location.href).searchParams.get(DATASET_PARAM)

  return matchIsFixtureDataset(value) ? value : 'demo'
}

const subscribe = (onChange: () => void) => {
  window.addEventListener(DATASET_CHANGE, onChange)
  window.addEventListener('popstate', onChange)

  return () => {
    window.removeEventListener(DATASET_CHANGE, onChange)
    window.removeEventListener('popstate', onChange)
  }
}

const serverDataset = (): FixtureDataset => {
  return 'demo'
}

export const FixtureDatasetToggle = () => {
  const queryClient = useQueryClient()
  const router = useRouter()
  const dataset = React.useSyncExternalStore(
    subscribe,
    datasetInUrl,
    serverDataset
  )

  React.useEffect(() => {
    document.cookie = `${FIXTURE_DATASET_COOKIE}=${dataset}; path=/; samesite=lax`
    void queryClient.resetQueries()
    void router.invalidate()
  }, [dataset, queryClient, router])

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-overlay flex justify-center">
      <ToggleGroup
        aria-label="Fixture data"
        variant="outline"
        spacing={0}
        value={[dataset]}
        className="pointer-events-auto bg-background shadow-md"
        onValueChange={(values) => {
          const [next] = values

          if (!matchIsFixtureDataset(next)) {
            return
          }

          const url = new URL(window.location.href)
          url.searchParams.set(DATASET_PARAM, next)
          window.history.replaceState(window.history.state, '', url)
          window.dispatchEvent(new Event(DATASET_CHANGE))
        }}
      >
        {FIXTURE_DATASETS.map((value) => {
          return (
            <ToggleGroupItem key={value} value={value} size="sm">
              {DATASET_LABELS[value]}
            </ToggleGroupItem>
          )
        })}
      </ToggleGroup>
    </div>
  )
}
