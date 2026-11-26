import React from 'react'
import {
  readRenderedColorScheme,
  subscribeToColorScheme,
  toggleColorScheme,
  type ColorScheme
} from '#/lib/color-scheme.ts'

const listeners = new Set<() => void>()

const subscribe = (onChange: () => void) => {
  listeners.add(onChange)
  const unsubscribe = subscribeToColorScheme(onChange)

  return () => {
    listeners.delete(onChange)
    unsubscribe()
  }
}

const toggle = () => {
  toggleColorScheme()

  for (const listener of listeners) {
    listener()
  }
}

const readOnServer = (): ColorScheme => {
  return 'light'
}

export const useColorScheme = () => {
  const scheme = React.useSyncExternalStore(
    subscribe,
    readRenderedColorScheme,
    readOnServer
  )
  return { scheme, toggle }
}
