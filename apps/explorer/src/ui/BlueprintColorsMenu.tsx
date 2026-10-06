import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { BlueprintOption } from '../types'
import { EYE_ICON_PATH } from './EyeIcon'

function VisibilityIcon({ visible, size = 16 }: { visible: boolean; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={EYE_ICON_PATH} />
      <circle cx="12" cy="12" r="3" />
      {!visible && <path d="M3 3l18 18" />}
    </svg>
  )
}

/** Toolbar button whose fold-out menu shows or hides each blueprint color on the map. */
export function BlueprintColorsMenu({
  options,
  hiddenColors,
  disabled = false,
  onSetHidden,
}: {
  options: BlueprintOption[]
  hiddenColors: string[]
  disabled?: boolean
  onSetHidden: (colors: string[], hidden: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties>()
  const triggerRef = useRef<HTMLDivElement>(null)
  const hidden = new Set(hiddenColors)
  const shownCount = options.filter((option) => !hidden.has(option.id)).length

  useLayoutEffect(() => {
    if (!open) return
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      setPosition({
        right: window.innerWidth - rect.right,
        bottom: window.innerHeight - rect.top + 8,
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Element &&
        (triggerRef.current?.contains(target) ||
          target.closest('[data-blueprint-colors-menu]'))
      ) {
        return
      }
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [open])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  if (options.length === 0) return null
  const allIds = options.map((option) => option.id)

  return (
    <div className="hud-actions-menu" ref={triggerRef}>
      <button
        className="hud-button hud-icon-button"
        data-active={shownCount < options.length}
        aria-label={`Blueprint colors, ${shownCount} of ${options.length} shown`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <VisibilityIcon visible={shownCount > 0} size={18} />
        <span className="hud-tooltip">Show or hide blueprint colors</span>
      </button>
      {open &&
        position &&
        createPortal(
          <div
            className="hud-actions-menu-list hud-blueprint-colors-menu"
            data-blueprint-colors-menu="true"
            role="menu"
            aria-label="Blueprint colors"
            style={position}
          >
            <div className="hud-blueprint-colors-actions">
              <button
                type="button"
                disabled={shownCount === options.length}
                onClick={() => onSetHidden(allIds, false)}
              >
                Show all
              </button>
              <button
                type="button"
                disabled={shownCount === 0}
                onClick={() => onSetHidden(allIds, true)}
              >
                Hide all
              </button>
            </div>
            {options.map((option) => {
              const shown = !hidden.has(option.id)
              return (
                <button
                  key={option.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={shown}
                  className="hud-blueprint-colors-item"
                  data-shown={shown}
                  onClick={() => onSetHidden([option.id], shown)}
                >
                  <span
                    className="hud-blueprint-colors-swatch"
                    style={{ background: option.hex }}
                  />
                  <span className="hud-blueprint-colors-name">{option.name}</span>
                  <VisibilityIcon visible={shown} />
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
