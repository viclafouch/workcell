import React from 'react'
import type { SessionView } from '@tanstack/ai-harness/view'
import { useCreateAtom, useSelector } from '@tanstack/react-store'
import {
  closeSessionView,
  openSessionView,
  readReadySessionView,
  reopenSessionView,
  watchSessionView
} from '#/lib/session-views.ts'
import type { HarnessName } from '#/server/dashboard-context.ts'

type UseSessionViewParams = {
  harness: HarnessName
  threadId: string
  isThreadActive: boolean
}

export const useSessionView = ({
  harness,
  threadId,
  isThreadActive
}: UseSessionViewParams) => {
  const viewAtom = useCreateAtom<SessionView | null>(
    readReadySessionView({ harness, threadId })
  )
  const [reloads, setReloads] = React.useState(0)

  React.useEffect(() => {
    const kept =
      reloads === 0
        ? openSessionView({ harness, threadId })
        : reopenSessionView({ harness, threadId })
    const unwatch = watchSessionView(kept)
    let isCancelled = false
    let hasRun = false
    let isShownIdle = false
    let stopWatching = () => {}

    const showSavedTurns = async () => {
      const saved = openSessionView({ harness, threadId })
      await saved.view.ready

      if (!isCancelled) {
        viewAtom.set(saved.view)
      }
    }

    const closeWhenIdle = () => {
      if (kept.view.store.get().status !== 'idle') {
        hasRun = true

        if (isShownIdle) {
          isShownIdle = false
          setReloads((count) => {
            return count + 1
          })
        }

        return
      }

      isShownIdle = true

      if (!isThreadActive && !kept.isClosed) {
        closeSessionView(kept)

        if (hasRun) {
          void showSavedTurns()
        }
      }
    }

    const showOnceReady = async () => {
      await kept.view.ready

      if (isCancelled) {
        return
      }

      viewAtom.set(kept.view)
      const subscription = kept.view.store.subscribe(closeWhenIdle)
      stopWatching = () => {
        subscription.unsubscribe()
      }
      closeWhenIdle()
    }
    void showOnceReady()

    return () => {
      isCancelled = true
      stopWatching()
      unwatch()
    }
  }, [harness, threadId, isThreadActive, reloads, viewAtom])

  return useSelector(viewAtom)
}
