import { createSessionView, type SessionView } from '@tanstack/ai-harness/view'
import type { HarnessName } from '#/server/console-context.ts'
import { createReadOnlySource } from './harness.ts'

const MOST_KEPT_VIEWS = 6

export type KeptSessionView = {
  view: SessionView
  isClosed: boolean
  isReady: boolean
  watchers: number
}

type SessionViewKey = {
  harness: HarnessName
  threadId: string
}

const keptViews = new Map<string, KeptSessionView>()

const readyViews = new Map<string, SessionView>()

const keyOf = ({ harness, threadId }: SessionViewKey) => {
  return `${harness}\u0000${threadId}`
}

export const closeSessionView = (kept: KeptSessionView) => {
  if (!kept.isClosed) {
    kept.isClosed = true
    kept.view.dispose()
  }
}

const keep = (key: string, kept: KeptSessionView) => {
  keptViews.delete(key)
  keptViews.set(key, kept)

  for (const [oldKey, oldView] of keptViews) {
    if (keptViews.size <= MOST_KEPT_VIEWS) {
      break
    }

    if (oldView.watchers === 0) {
      closeSessionView(oldView)
      keptViews.delete(oldKey)
      readyViews.delete(oldKey)
    }
  }
}

const closeIfIdleAndUnwatched = (kept: KeptSessionView) => {
  if (kept.watchers === 0 && kept.view.store.get().status === 'idle') {
    closeSessionView(kept)
  }
}

const markReady = async (key: string, kept: KeptSessionView) => {
  await kept.view.ready
  kept.isReady = true

  if (keptViews.get(key) === kept) {
    readyViews.set(key, kept.view)
  }

  closeIfIdleAndUnwatched(kept)
}

export const watchSessionView = (kept: KeptSessionView) => {
  kept.watchers += 1

  return () => {
    kept.watchers -= 1

    if (kept.isReady) {
      closeIfIdleAndUnwatched(kept)
    }
  }
}

export const readReadySessionView = (key: SessionViewKey) => {
  return readyViews.get(keyOf(key)) ?? null
}

export const openSessionView = (key: SessionViewKey) => {
  const id = keyOf(key)
  const existing = keptViews.get(id)

  if (existing !== undefined && !existing.isClosed) {
    keep(id, existing)

    return existing
  }

  const kept: KeptSessionView = {
    view: createSessionView(createReadOnlySource(key)),
    isClosed: false,
    isReady: false,
    watchers: 0
  }
  void markReady(id, kept)
  keep(id, kept)

  return kept
}

export const reopenSessionView = (key: SessionViewKey) => {
  const existing = keptViews.get(keyOf(key))

  if (existing !== undefined) {
    closeSessionView(existing)
  }

  return openSessionView(key)
}
