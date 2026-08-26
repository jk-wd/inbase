import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { shouldIgnoreShortcut } from '../keyboard'

export type MapContextMenuState = {
  x: number
  y: number
  folder: string
}

type MapContextMenuProps = {
  menu: MapContextMenuState | null
  onAddFile: (folder: string) => void
  onAddFolder: (folder: string) => void
  onClose: () => void
}

export function MapContextMenu({
  menu,
  onAddFile,
  onAddFolder,
  onClose,
}: MapContextMenuProps) {
  useEffect(() => {
    if (!menu) return
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return
      if (shouldIgnoreShortcut(event)) return
      event.preventDefault()
      onClose()
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.map-context-menu')) {
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [menu, onClose])

  if (!menu) return null

  const pad = 8
  const width = 176
  const height = 84
  const left = Math.min(
    Math.max(pad, menu.x),
    window.innerWidth - width - pad,
  )
  const top = Math.min(
    Math.max(pad, menu.y),
    window.innerHeight - height - pad,
  )

  return createPortal(
    <div
      className="map-context-menu"
      role="menu"
      style={{ left, top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onAddFile(menu.folder)
          onClose()
        }}
      >
        Add file
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onAddFolder(menu.folder)
          onClose()
        }}
      >
        Add folder
      </button>
    </div>,
    document.body,
  )
}
