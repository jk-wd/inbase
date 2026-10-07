import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { FLY_TO_KINDS, findFlyToMatch, type FlyToKind, type FlyToTarget } from '../flyTo'
import type { CodebaseGraph } from '../types'

function FlyToIcon({ size = 18 }: { size?: number }) {
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
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  )
}

/** Toolbar button whose fold-out searches the codebase and flies the map camera to the closest match. */
export function MapFlyToMenu({
  graph,
  disabled = false,
  onFlyTo,
}: {
  graph: CodebaseGraph
  disabled?: boolean
  onFlyTo: (target: FlyToTarget) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<FlyToKind>('file')
  const [position, setPosition] = useState<CSSProperties>()
  const triggerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(
    () =>
      open
        ? FLY_TO_KINDS.map((option) => ({ kind: option, match: findFlyToMatch(graph, option, query) }))
        : [],
    [graph, open, query],
  )

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
    if (!open || !position) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [open, position])

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
        (triggerRef.current?.contains(target) || target.closest('[data-map-fly-to-menu]'))
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

  const flyTo = (option: FlyToKind) => {
    const match = matches.find((entry) => entry.kind === option)?.match
    if (!match) return
    setKind(option)
    setOpen(false)
    onFlyTo({ fileId: match.fileId, folderPath: match.folderPath })
  }

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      const index = FLY_TO_KINDS.indexOf(kind)
      setKind(FLY_TO_KINDS[(index + step + FLY_TO_KINDS.length) % FLY_TO_KINDS.length])
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()
    const preferred = matches.find((entry) => entry.kind === kind && entry.match)
    const fallback = preferred ?? matches.find((entry) => entry.match)
    if (fallback) flyTo(fallback.kind)
  }

  return (
    <div className="hud-actions-menu" ref={triggerRef}>
      <button
        className="hud-button hud-icon-button"
        aria-label="Fly to a file, folder, function, or variable"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <FlyToIcon />
        <span className="hud-tooltip">Fly to…</span>
      </button>
      {open &&
        position &&
        createPortal(
          <div
            className="hud-actions-menu-list hud-fly-to-menu"
            data-map-fly-to-menu="true"
            role="dialog"
            aria-label="Fly to"
            style={position}
          >
            <input
              ref={inputRef}
              className="hud-fly-to-input"
              type="search"
              placeholder="Search name or path…"
              value={query}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
            />
            {matches.map(({ kind: option, match }) => (
              <button
                key={option}
                type="button"
                className="hud-fly-to-item"
                data-active={option === kind}
                disabled={!match}
                onClick={() => flyTo(option)}
                onPointerEnter={() => setKind(option)}
              >
                <span className="hud-fly-to-kind">Fly to {option}</span>
                {match ? (
                  <span className="hud-fly-to-match" title={match.detail}>
                    <span className="hud-fly-to-label">{match.label}</span>
                    <span className="hud-fly-to-detail">{match.detail}</span>
                  </span>
                ) : (
                  <span className="hud-fly-to-match hud-fly-to-empty">
                    {query.trim() ? 'No match' : '—'}
                  </span>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
