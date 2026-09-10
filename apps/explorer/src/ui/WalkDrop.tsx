import { useEffect, useRef } from 'react'
import { PersonIcon } from './EyeIcon'

type WalkDropProps = {
  cursor: { x: number; y: number } | null
  disabled?: boolean
  onStart: (x: number, y: number) => void
  onMove: (x: number, y: number) => void
  onEnd: () => void
}

export function WalkDrop({
  cursor,
  disabled = false,
  onStart,
  onMove,
  onEnd,
}: WalkDropProps) {
  const dragging = Boolean(cursor) && !disabled
  const onMoveRef = useRef(onMove)
  const onEndRef = useRef(onEnd)
  onMoveRef.current = onMove
  onEndRef.current = onEnd

  useEffect(() => {
    if (!dragging) return
    const move = (event: PointerEvent) => {
      onMoveRef.current(event.clientX, event.clientY)
    }
    const end = () => onEndRef.current()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [dragging])

  return (
    <>
      <button
        className="hud-button hud-icon-button hud-walk-drop"
        type="button"
        aria-label="Drag onto the map to walk"
        aria-disabled={disabled}
        disabled={disabled}
        data-dragging={dragging ? 'true' : undefined}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return
          event.preventDefault()
          onStart(event.clientX, event.clientY)
        }}
      >
        <PersonIcon size={18} />
        <span className="hud-tooltip">
          {disabled
            ? 'Unavailable in explain mode'
            : 'Drag onto the map to walk'}
        </span>
      </button>
      {cursor && !disabled && (
        <div
          className="hud-walk-drop-ghost"
          style={{ left: cursor.x, top: cursor.y }}
          aria-hidden="true"
        >
          <PersonIcon size={28} />
        </div>
      )}
    </>
  )
}
