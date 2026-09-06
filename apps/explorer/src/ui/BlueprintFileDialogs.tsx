import { useEffect, useRef, useState } from 'react'
import { beginKeyboardIsolation } from '../keyboard'
import type { SavedBlueprintListItem } from '../types'

function useDialogKeys(onClose: () => void) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const release = beginKeyboardIsolation()
    document.exitPointerLock()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      release()
    }
  }, [])
}

export function BlueprintSaveDialog({
  mode,
  defaultName,
  defaultDirectory,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  mode: 'save' | 'save-as'
  defaultName: string
  defaultDirectory: string
  busy: boolean
  error: string | null
  onSubmit: (input: { name: string; directory?: string }) => void
  onClose: () => void
}) {
  const nameRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(defaultName)
  const [directory, setDirectory] = useState(defaultDirectory)
  useDialogKeys(onClose)
  useEffect(() => {
    const timer = window.setTimeout(() => nameRef.current?.focus(), 40)
    return () => window.clearTimeout(timer)
  }, [])

  const title = mode === 'save-as' ? 'Save blueprint as' : 'Save blueprint'
  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    onSubmit({
      name: trimmed,
      directory: mode === 'save-as' ? directory.trim() || defaultDirectory : undefined,
    })
  }

  return (
    <div className="hud-note-overlay" onClick={onClose}>
      <form
        className="hud-blueprint-file-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hud-blueprint-file-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="hud-note-header">
          <div className="hud-note-heading">
            <h1 id="hud-blueprint-file-title">{title}</h1>
            <p className="hud-note-subtitle">
              {mode === 'save-as'
                ? 'Choose a name and folder. Leave the folder as blueprints to use the project default.'
                : 'Saved in the project blueprints folder. Use Save as to pick another folder.'}
            </p>
          </div>
          <button className="hud-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <label className="hud-blueprint-file-field">
          <span>Name</span>
          <input
            ref={nameRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="login page"
            autoComplete="off"
            spellCheck={false}
            aria-label="Blueprint name"
          />
        </label>
        {mode === 'save-as' ? (
          <label className="hud-blueprint-file-field">
            <span>Folder</span>
            <input
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
              placeholder={defaultDirectory}
              autoComplete="off"
              spellCheck={false}
              aria-label="Blueprint folder"
            />
          </label>
        ) : null}
        {error ? <p className="hud-blueprint-file-error">{error}</p> : null}
        <div className="hud-blueprint-file-actions">
          <button className="hud-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="hud-button" type="submit" disabled={!name.trim() || busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

export function BlueprintLoadDialog({
  directory,
  items,
  busy,
  error,
  onLoad,
  onLoadDocument,
  onClose,
}: {
  directory: string
  items: SavedBlueprintListItem[]
  busy: boolean
  error: string | null
  onLoad: (item: SavedBlueprintListItem) => void
  onLoadDocument: (document: unknown) => void
  onClose: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  useDialogKeys(onClose)
  const shownError = parseError || error

  return (
    <div className="hud-note-overlay" onClick={onClose}>
      <div
        className="hud-blueprint-file-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hud-blueprint-file-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="hud-note-header">
          <div className="hud-note-heading">
            <h1 id="hud-blueprint-file-title">Load blueprint</h1>
            <p className="hud-note-subtitle">
              {directory ? `From ${directory}` : 'Choose a saved blueprint'}
            </p>
          </div>
          <button className="hud-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {items.length === 0 ? (
          <p className="hud-blueprint-file-empty">
            No blueprints in the project folder yet. Save one, or choose a file.
          </p>
        ) : (
          <ul className="hud-blueprint-file-list">
            {items.map((item) => (
              <li key={item.path}>
                <button
                  className="hud-button hud-blueprint-file-item"
                  type="button"
                  disabled={busy}
                  onClick={() => onLoad(item)}
                >
                  <span className="hud-blueprint-file-item-name">{item.name}</span>
                  <span className="hud-blueprint-file-item-path">
                    {item.relativePath}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {shownError ? <p className="hud-blueprint-file-error">{shownError}</p> : null}
        <div className="hud-blueprint-file-actions">
          <input
            ref={fileRef}
            className="hud-blueprint-file-hidden"
            type="file"
            accept="application/json,.json"
            aria-label="Choose blueprint file"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              void file.text().then((text) => {
                try {
                  setParseError(null)
                  onLoadDocument(JSON.parse(text))
                } catch {
                  setParseError('That file is not valid JSON.')
                }
              })
            }}
          />
          <button
            className="hud-button"
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Choose file…
          </button>
          <button className="hud-button" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
