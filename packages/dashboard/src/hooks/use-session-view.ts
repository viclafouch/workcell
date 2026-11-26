import React from 'react'
import { createSessionView, type SessionView } from '@tanstack/ai-harness/view'
import { useCreateAtom, useSelector } from '@tanstack/react-store'
import { createReadOnlySource } from '#/lib/harness.ts'
import type { HarnessName } from '#/server/dashboard-context.ts'
import { useIsDocumentVisible } from './use-document-visibility.ts'

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
  const isVisible = useIsDocumentVisible()
  const viewAtom = useCreateAtom<SessionView | null>(null)

  React.useEffect(() => {
    if (!isVisible) {
      return
    }

    const view = createSessionView(createReadOnlySource({ harness, threadId }))
    const stops: (() => void)[] = []
    let isDisposed = false
    const dispose = () => {
      if (!isDisposed) {
        isDisposed = true

        for (const stop of stops) {
          stop()
        }

        view.dispose()
      }
    }
    const stopWhenIdle = () => {
      if (!isThreadActive && view.store.get().status === 'idle') {
        dispose()
      }
    }
    const watchOnceReady = async () => {
      await view.ready

      if (isDisposed) {
        return
      }

      const subscription = view.store.subscribe(stopWhenIdle)
      stops.push(() => {
        subscription.unsubscribe()
      })
      stopWhenIdle()
    }
    viewAtom.set(view)
    void watchOnceReady()

    return dispose
  }, [harness, threadId, isThreadActive, isVisible, viewAtom])

  return useSelector(viewAtom)
}
