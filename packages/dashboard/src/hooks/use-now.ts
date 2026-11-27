import React from 'react'

const MILLISECONDS_PER_MINUTE = 60_000

const listeners = new Set<() => void>()

let now = Date.now()

let timer: ReturnType<typeof setTimeout> | null = null

const tickAtNextMinute = () => {
  timer = setTimeout(
    () => {
      now = Date.now()

      for (const listener of listeners) {
        listener()
      }

      tickAtNextMinute()
    },
    MILLISECONDS_PER_MINUTE - (Date.now() % MILLISECONDS_PER_MINUTE)
  )
}

const subscribe = (listener: () => void) => {
  if (listeners.size === 0) {
    now = Date.now()
    tickAtNextMinute()
  }

  listeners.add(listener)

  return () => {
    listeners.delete(listener)

    if (listeners.size === 0 && timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
}

const readNow = () => {
  return now
}

export const useNow = () => {
  return React.useSyncExternalStore(subscribe, readNow, readNow)
}
