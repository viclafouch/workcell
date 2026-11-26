import React from 'react'

const subscribe = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange)

  return () => {
    document.removeEventListener('visibilitychange', onChange)
  }
}

const readIsVisible = () => {
  return document.visibilityState === 'visible'
}

const readIsVisibleOnServer = () => {
  return false
}

export const useIsDocumentVisible = () => {
  return React.useSyncExternalStore(
    subscribe,
    readIsVisible,
    readIsVisibleOnServer
  )
}
