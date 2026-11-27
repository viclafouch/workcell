import React from 'react'

const WIDE_SCREEN_QUERY = '(width >= 64rem)'

const subscribe = (onChange: () => void) => {
  const mediaQuery = window.matchMedia(WIDE_SCREEN_QUERY)
  mediaQuery.addEventListener('change', onChange)

  return () => {
    mediaQuery.removeEventListener('change', onChange)
  }
}

const readIsWide = () => {
  return window.matchMedia(WIDE_SCREEN_QUERY).matches
}

const readIsWideOnServer = () => {
  return true
}

export const useIsWideScreen = () => {
  return React.useSyncExternalStore(subscribe, readIsWide, readIsWideOnServer)
}
