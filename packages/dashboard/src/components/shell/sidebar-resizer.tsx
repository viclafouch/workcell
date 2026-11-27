import React from 'react'
import { useSidebar } from '#/components/ui/sidebar.tsx'
import {
  forgetSidebarWidth,
  keepSidebarWidth,
  readSidebarWidthBounds
} from '#/lib/sidebar-width.ts'

const FOLD_SHARE = 0.5

const MOVE_THRESHOLD_PX = 2

const KEY_STEP_PX = 16

const LARGE_KEY_STEP_PX = 64

type Resize = {
  pointerId: number
  wrapper: HTMLElement
  targets: HTMLElement[]
  startX: number
  pendingX: number
  startWidthPx: number
  widthPx: number
  minPx: number
  maxPx: number
  foldedPx: number
  isFolding: boolean
  hasMoved: boolean
  frame: number | null
  stopOnBlur: () => void
}

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max)
}

const sidebarPartsOf = (handle: HTMLElement) => {
  const wrapper = handle.closest<HTMLElement>('[data-slot="sidebar-wrapper"]')
  const sidebar = handle.closest<HTMLElement>('[data-slot="sidebar"]')
  const container = handle.closest<HTMLElement>(
    '[data-slot="sidebar-container"]'
  )
  const gap = sidebar?.querySelector<HTMLElement>('[data-slot="sidebar-gap"]')

  return wrapper === null ||
    container === null ||
    gap === null ||
    gap === undefined
    ? null
    : { wrapper, container, gap }
}

const describeWidth = (handle: HTMLElement, isOpen: boolean) => {
  const parts = sidebarPartsOf(handle)

  if (parts === null) {
    return
  }

  const { minPx, maxPx } = readSidebarWidthBounds(parts.wrapper)
  handle.setAttribute('aria-valuemin', String(Math.round(minPx)))
  handle.setAttribute('aria-valuemax', String(Math.round(maxPx)))
  handle.setAttribute(
    'aria-valuenow',
    String(Math.round(parts.container.getBoundingClientRect().width))
  )
  handle.setAttribute('aria-valuetext', isOpen ? 'Open' : 'Folded')
}

const showWidth = (resize: Resize) => {
  const rawWidthPx = resize.startWidthPx + resize.pendingX - resize.startX
  resize.isFolding = rawWidthPx < resize.minPx * FOLD_SHARE
  resize.widthPx = resize.isFolding
    ? resize.foldedPx
    : clamp(rawWidthPx, resize.minPx, resize.maxPx)

  for (const target of resize.targets) {
    target.style.width = `${resize.widthPx}px`
  }
}

const releaseTargets = (resize: Resize) => {
  for (const target of resize.targets) {
    target.style.removeProperty('width')
    target.style.removeProperty('transition-duration')
  }

  delete resize.wrapper.dataset.resizing
}

export const SidebarResizer = () => {
  const { open, setOpen } = useSidebar()
  const handleRef = React.useRef<HTMLHRElement>(null)
  const resizeRef = React.useRef<Resize | null>(null)

  React.useEffect(() => {
    if (handleRef.current !== null) {
      describeWidth(handleRef.current, open)
    }
  }, [open])

  const finishResize = (shouldCommit: boolean) => {
    const resize = resizeRef.current

    if (resize === null) {
      return
    }

    resizeRef.current = null

    if (resize.frame !== null) {
      cancelAnimationFrame(resize.frame)
    }

    window.removeEventListener('blur', resize.stopOnBlur)

    if (!shouldCommit || !resize.hasMoved) {
      releaseTargets(resize)

      return
    }

    showWidth(resize)

    if (resize.isFolding) {
      releaseTargets(resize)
      setOpen(false)

      return
    }

    keepSidebarWidth(resize.widthPx)
    releaseTargets(resize)

    if (!open) {
      setOpen(true)
    }
  }

  const stopOnBlur = () => {
    finishResize(true)
  }

  const startResize = (event: React.PointerEvent<HTMLHRElement>) => {
    const handle = event.currentTarget
    const parts = sidebarPartsOf(handle)

    if (event.button !== 0 || resizeRef.current !== null || parts === null) {
      return
    }

    event.preventDefault()
    handle.setPointerCapture(event.pointerId)
    const { minPx, maxPx, foldedPx } = readSidebarWidthBounds(parts.wrapper)
    const startWidthPx = parts.container.getBoundingClientRect().width
    const targets = [parts.gap, parts.container]

    for (const target of targets) {
      target.style.transitionDuration = '0ms'
    }

    parts.wrapper.dataset.resizing = ''
    window.addEventListener('blur', stopOnBlur)
    resizeRef.current = {
      pointerId: event.pointerId,
      wrapper: parts.wrapper,
      targets,
      startX: event.clientX,
      pendingX: event.clientX,
      startWidthPx,
      widthPx: startWidthPx,
      minPx,
      maxPx,
      foldedPx,
      isFolding: false,
      hasMoved: false,
      frame: null,
      stopOnBlur
    }
  }

  const moveResize = (event: React.PointerEvent<HTMLHRElement>) => {
    const resize = resizeRef.current

    if (resize === null || resize.pointerId !== event.pointerId) {
      return
    }

    resize.pendingX = event.clientX
    if (Math.abs(event.clientX - resize.startX) > MOVE_THRESHOLD_PX) {
      resize.hasMoved = true
    }

    if (resize.frame !== null) {
      return
    }

    resize.frame = requestAnimationFrame(() => {
      resize.frame = null
      showWidth(resize)
    })
  }

  const endResize = (event: React.PointerEvent<HTMLHRElement>) => {
    const resize = resizeRef.current

    if (resize === null || resize.pointerId !== event.pointerId) {
      return
    }

    resize.pendingX = event.clientX
    finishResize(true)
  }

  const resizeWithKeys = (event: React.KeyboardEvent<HTMLHRElement>) => {
    const handle = event.currentTarget
    const parts = sidebarPartsOf(handle)

    if (parts === null) {
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      setOpen(!open)

      return
    }

    const { minPx, maxPx } = readSidebarWidthBounds(parts.wrapper)
    const step = event.shiftKey ? LARGE_KEY_STEP_PX : KEY_STEP_PX
    const currentPx = parts.container.getBoundingClientRect().width
    const target = new Map([
      ['ArrowLeft', currentPx - step],
      ['ArrowRight', currentPx + step],
      ['Home', minPx],
      ['End', maxPx]
    ]).get(event.key)

    if (target === undefined) {
      return
    }

    event.preventDefault()
    keepSidebarWidth(clamp(target, minPx, maxPx))

    if (!open) {
      setOpen(true)
    }

    describeWidth(handle, true)
  }

  const resetWidth = (event: React.MouseEvent<HTMLHRElement>) => {
    forgetSidebarWidth()

    if (!open) {
      setOpen(true)
    }

    describeWidth(event.currentTarget, true)
  }

  return (
    <hr
      ref={handleRef}
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Sidebar width. Drag it, or use the arrow keys. Enter folds it."
      data-slot="sidebar-resizer"
      className="sidebar-resizer absolute inset-y-0 -right-2 z-20 m-0 hidden h-auto w-4 border-0 md:block"
      onPointerDown={startResize}
      onPointerMove={moveResize}
      onPointerUp={endResize}
      onPointerCancel={() => {
        finishResize(false)
      }}
      onLostPointerCapture={() => {
        finishResize(true)
      }}
      onKeyDown={resizeWithKeys}
      onDoubleClick={resetWidth}
    />
  )
}
