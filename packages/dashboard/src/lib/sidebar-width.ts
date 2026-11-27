import { SIDEBAR_STATE_COOKIE } from '#/constants/navigation.ts'

export const SIDEBAR_WIDTH_STORAGE_KEY = 'workcell-sidebar-width'

export const SIDEBAR_WIDTH_PROPERTY = '--sidebar-width-chosen'

export const SIDEBAR_WIDTH_SCRIPT = `try{const r=document.documentElement;const w=Number(localStorage.getItem('${SIDEBAR_WIDTH_STORAGE_KEY}'));if(w>0)r.style.setProperty('${SIDEBAR_WIDTH_PROPERTY}',w+'px');if(document.cookie.split('; ').includes('${SIDEBAR_STATE_COOKIE}=false'))r.dataset.sidebarFolded=''}catch{}`

const showSidebarWidth = (widthPx: number) => {
  document.documentElement.style.setProperty(
    SIDEBAR_WIDTH_PROPERTY,
    `${widthPx}px`
  )
}

const storeSidebarWidth = (widthPx: number | null) => {
  try {
    if (widthPx === null) {
      localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY)
    } else {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(widthPx))
    }

    return true
  } catch {
    return false
  }
}

export const keepSidebarWidth = (widthPx: number) => {
  showSidebarWidth(widthPx)
  storeSidebarWidth(widthPx)
}

export const forgetSidebarWidth = () => {
  document.documentElement.style.removeProperty(SIDEBAR_WIDTH_PROPERTY)
  storeSidebarWidth(null)
}

type SidebarWidthBounds = {
  minPx: number
  maxPx: number
  defaultPx: number
  foldedPx: number
}

const lengthInPx = (value: string, rootFontPx: number) => {
  const length = Number.parseFloat(value)

  return value.trim().endsWith('rem') ? length * rootFontPx : length
}

export const readSidebarWidthBounds = (
  wrapper: HTMLElement
): SidebarWidthBounds => {
  const styles = getComputedStyle(wrapper)
  const rootFontPx = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize
  )
  const read = (name: string) => {
    return lengthInPx(styles.getPropertyValue(name), rootFontPx)
  }

  const minPx = read('--sidebar-width-min')

  return {
    minPx,
    maxPx: Math.max(
      minPx,
      Math.min(
        read('--sidebar-width-max'),
        window.innerWidth - read('--main-width-min')
      )
    ),
    defaultPx: read('--sidebar-width-default'),
    foldedPx: read('--sidebar-width-folded')
  }
}
