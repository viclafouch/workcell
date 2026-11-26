export type ColorScheme = 'light' | 'dark'

export const COLOR_SCHEME_STORAGE_KEY = 'workcell-color-scheme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

export const COLOR_SCHEME_SCRIPT = `try{const s=localStorage.getItem('${COLOR_SCHEME_STORAGE_KEY}');if(s==='light'||s==='dark')document.documentElement.dataset.colorScheme=s}catch{}`

export const matchIsColorScheme = (value: unknown): value is ColorScheme => {
  return value === 'light' || value === 'dark'
}

export const readSystemColorScheme = (): ColorScheme => {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

export const readStoredColorScheme = () => {
  try {
    const stored = localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)

    return matchIsColorScheme(stored) ? stored : null
  } catch {
    return null
  }
}

export const readRenderedColorScheme = (): ColorScheme => {
  return readStoredColorScheme() ?? readSystemColorScheme()
}

const writeStoredColorScheme = (scheme: ColorScheme | null) => {
  try {
    if (scheme === null) {
      localStorage.removeItem(COLOR_SCHEME_STORAGE_KEY)
    } else {
      localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, scheme)
    }

    return true
  } catch {
    return false
  }
}

export const applyColorScheme = (scheme: ColorScheme | null) => {
  if (scheme === null) {
    delete document.documentElement.dataset.colorScheme
  } else {
    document.documentElement.dataset.colorScheme = scheme
  }
}

export const toggleColorScheme = () => {
  const target: ColorScheme =
    readRenderedColorScheme() === 'dark' ? 'light' : 'dark'
  const stored = target === readSystemColorScheme() ? null : target
  writeStoredColorScheme(stored)
  applyColorScheme(stored)
}

export const subscribeToColorScheme = (onChange: () => void) => {
  const media = window.matchMedia(DARK_QUERY)
  const onStorage = (event: StorageEvent) => {
    if (event.key === COLOR_SCHEME_STORAGE_KEY) {
      applyColorScheme(readStoredColorScheme())
      onChange()
    }
  }
  media.addEventListener('change', onChange)
  window.addEventListener('storage', onStorage)

  return () => {
    media.removeEventListener('change', onChange)
    window.removeEventListener('storage', onStorage)
  }
}
