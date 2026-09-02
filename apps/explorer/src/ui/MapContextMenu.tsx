import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { shouldIgnoreShortcut } from '../keyboard'

export type MapContextMenuState = {
  x: number
  y: number
  folder?: string
  file?: string
  color?: string
}

type MapContextMenuProps = {
  menu: MapContextMenuState | null
  pointed?: boolean
  onAddFile: (folder: string, color?: string) => void
  onAddFolder: (folder: string, color?: string) => void
  onOpenFile?: (fileId: string) => void
  onPointToFolder?: (folder: string) => void
  onClose: () => void
}

export function MapContextMenu({
  menu,
  pointed = false,
  onAddFile,
  onAddFolder,
  onOpenFile,
  onPointToFolder,
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

  const fileId = menu.file
  const folder = menu.folder
  const pad = 8
  const width = 176
  const height = fileId ? 44 : onPointToFolder ? 126 : 84
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
      {fileId ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onOpenFile?.(fileId)
            onClose()
          }}
        >
          Open file
        </button>
      ) : folder ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onAddFile(folder, menu.color)
              onClose()
            }}
          >
            Add file
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onAddFolder(folder, menu.color)
              onClose()
            }}
          >
            Add folder
          </button>
          {onPointToFolder && (
            <button
              type="button"
              role="menuitem"
              aria-pressed={pointed}
              onClick={() => {
                onPointToFolder(folder)
                onClose()
              }}
            >
              {pointed ? 'Stop pointing' : 'Point to folder'}
            </button>
          )}
        </>
      ) : null}
    </div>,
    document.body,
  )
}
