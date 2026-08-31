import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { InfoNameField, NameInput } from './NameInput'
import {
  isReviewingIntent,
  type AgentIntent,
  type AgentIntentStatus,
  type AimedRelation,
  type BlueprintNote,
  type BlueprintNoteKind,
  GLOBAL_BLUEPRINT_COLOR,
  type BlueprintOption,
  type BlueprintPointer,
  type BlueprintPointerKind,
  type BranchChanges,
  type CodebaseGraph,
  type ExplainTargetKind,
  type PatchImportAddition,
  type PatchSymbolAddition,
  type ViewMode,
  type WorkflowAction,
} from '../types'
import { findBlueprintNote, findBlueprintPointer } from '../userCreated'
import { EyeIcon } from './EyeIcon'
import { beginKeyboardIsolation, shouldIgnoreShortcut } from '../keyboard'
import type { DevTargetsState } from '../devTargets'

function reviewTitle(status: AgentIntentStatus) {
  if (status === 'blueprint_ask') return 'Setup blueprint'
  if (status === 'blueprint') return 'Blueprint'
  if (status === 'preparing') return 'LLM preparing'
  if (status === 'planned') return 'Plan ready'
  if (status === 'working') return 'LLM working'
  if (status === 'replanning') return 'LLM revising plan'
  if (status === 'pending') return 'Review this step'
  if (status === 'extended') return 'Extended diff'
  if (status === 'approved') return 'Completed step'
  if (status === 'finished') return 'Finished'
  return 'Visual workflow'
}

function sessionLabel(intent: AgentIntent) {
  return intent.name?.trim() || intent.feature?.trim() || ''
}

function sessionColorName(intent: AgentIntent) {
  return intent.colorName?.trim() || ''
}

function sessionSlashCommand(intent: Pick<AgentIntent, 'color'>) {
  const color = intent.color?.trim()
  if (!color || color === 'blue') return null
  return `/${color}`
}

function ColorConnectHint({
  colorCommand,
  queued,
}: {
  colorCommand?: string | null
  queued?: boolean
}) {
  return (
    <p>
      {queued && colorCommand ? (
        <>
          Type <kbd>{colorCommand}</kbd> in a Cursor chat to skip the queue and
          connect here.{' '}
        </>
      ) : null}
      Use <kbd>/coral</kbd>, <kbd>/amber</kbd>, <kbd>/lime</kbd>,{' '}
      <kbd>/orange</kbd>, or <kbd>/violet</kbd> to connect to that color
      {!queued && colorCommand ? (
        <>
          {' '}
          — this session is <kbd>{colorCommand}</kbd>
        </>
      ) : null}
      . Aliases: <kbd>/red</kbd>, <kbd>/yellow</kbd>, <kbd>/green</kbd>,{' '}
      <kbd>/purple</kbd>. <kbd>/blue</kbd> is the global blueprint, not a chat.
    </p>
  )
}

function sessionDisplayName(intent: AgentIntent) {
  return sessionLabel(intent) || sessionColorName(intent)
}

function SessionSwatch({
  colorHex,
  className = 'hud-session-swatch',
}: {
  colorHex?: string | null
  className?: string
}) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={
        colorHex
          ? ({ '--session-color': colorHex } as CSSProperties)
          : undefined
      }
    />
  )
}

type BlueprintColorOption = BlueprintOption & { pointers: BlueprintPointer[] }

function optionPointed(
  option: BlueprintColorOption,
  target: { kind: BlueprintPointerKind; path: string; name?: string },
) {
  return findBlueprintPointer(
    option.pointers,
    target.kind,
    target.path,
    target.name,
  )
}

function placeAnchoredMenu(
  trigger: DOMRect,
  menuHeight: number,
  width: number,
  alignEnd: boolean,
) {
  const gap = 4
  const pad = 8
  const left = Math.min(
    Math.max(pad, alignEnd ? trigger.right - width : trigger.left),
    window.innerWidth - width - pad,
  )
  const spaceBelow = window.innerHeight - trigger.bottom - pad
  const spaceAbove = trigger.top - pad
  const openAbove =
    menuHeight > 0 &&
    menuHeight + gap > spaceBelow &&
    spaceAbove > spaceBelow
  const maxHeight = Math.max(0, (openAbove ? spaceAbove : spaceBelow) - gap)
  const usedHeight = menuHeight > 0 ? Math.min(menuHeight, maxHeight) : 0
  const top = openAbove
    ? Math.max(pad, trigger.top - usedHeight - gap)
    : trigger.bottom + gap
  return { top, left, width, maxHeight }
}

function PointColorControl({
  target,
  colorPointers = [],
  currentColorId,
  onToggle,
  compact = false,
  idleLabel,
  pointedLabel,
  disabled = false,
}: {
  target: { kind: BlueprintPointerKind; path: string; name?: string }
  colorPointers?: BlueprintColorOption[]
  currentColorId?: string | null
  onToggle: (color?: string) => void
  compact?: boolean
  idleLabel: string
  pointedLabel: string
  disabled?: boolean
}) {
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const current =
    colorPointers.find((option) => option.id === (currentColorId ?? 'global')) ??
    colorPointers[0]
  const currentHex = current?.hex ?? GLOBAL_BLUEPRINT_COLOR.hex
  const pointed = current ? optionPointed(current, target) : false
  const showMenu = colorPointers.length > 0

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const trigger = triggerRef.current
      const menu = menuRef.current
      if (!trigger || !menu) return
      const rect = trigger.getBoundingClientRect()
      const width = compact ? 168 : Math.max(rect.width, 168)
      menu.style.maxHeight = 'none'
      const { top, left, maxHeight } = placeAnchoredMenu(
        rect,
        menu.offsetHeight,
        width,
        compact,
      )
      menu.style.top = `${top}px`
      menu.style.left = `${left}px`
      menu.style.width = `${width}px`
      menu.style.maxHeight = `${maxHeight}px`
      menu.style.visibility = 'visible'
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [compact, open, colorPointers.length])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return
      if (shouldIgnoreShortcut(event)) return
      event.preventDefault()
      setOpen(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      const node = event.target
      if (
        node instanceof Element &&
        (triggerRef.current?.contains(node) ||
          node.closest('.hud-point-dropdown'))
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

  return (
    <div
      ref={triggerRef}
      className={
        compact ? 'hud-point-menu hud-point-menu-compact' : 'hud-point-menu'
      }
    >
      <button
        className={
          compact ? 'hud-item-point' : 'hud-button hud-inspect hud-point'
        }
        type="button"
        data-pointed={pointed ? 'true' : 'false'}
        data-active={open}
        aria-pressed={pointed}
        aria-haspopup={showMenu ? 'menu' : undefined}
        aria-expanded={showMenu ? open : undefined}
        aria-label={compact ? (pointed ? pointedLabel : idleLabel) : undefined}
        disabled={disabled}
        style={
          {
            '--session-color': currentHex,
          } as CSSProperties
        }
        onClick={() => {
          if (!showMenu || disabled) return
          setOpen((currentOpen) => !currentOpen)
        }}
      >
        <EyeIcon size={compact ? 13 : 15} />
        {compact ? null : pointed ? pointedLabel : idleLabel}
      </button>
      {open &&
        showMenu &&
        createPortal(
          <div ref={menuRef} className="hud-point-dropdown" role="menu">
            <button
              type="button"
              role="menuitem"
              className="hud-point-dropdown-cancel"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            {colorPointers.map((option) => {
              const selected = optionPointed(option, target)
              return (
                <button
                  key={option.id}
                  type="button"
                  role="menuitem"
                  data-pointed={selected ? 'true' : 'false'}
                  aria-pressed={selected}
                  style={
                    {
                      '--session-color': option.hex,
                    } as CSSProperties
                  }
                  onClick={() => {
                    onToggle(option.id)
                    setOpen(false)
                  }}
                >
                  <EyeIcon size={15} />
                  <span>
                    {option.kind === 'global' ? 'Global' : option.name}
                  </span>
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}

function fileBase(id: string) {
  return id.split('/').pop() ?? id
}

function symbolLabels(items: PatchSymbolAddition[]) {
  const files = new Set(items.map((item) => item.file))
  const showFile = files.size > 1
  return items.map((item) => ({
    key: `${item.file}:${item.name}`,
    label: showFile ? `${item.name} · ${fileBase(item.file)}` : item.name,
  }))
}

function importLabel(item: Pick<PatchImportAddition, 'name' | 'from'>) {
  const from = fileBase(item.from)
  return item.name === item.from || item.name === from
    ? from
    : `${item.name} from ${from}`
}

function importLabels(items: PatchImportAddition[]) {
  const files = new Set(items.map((item) => item.file))
  const showFile = files.size > 1
  return items.map((item) => {
    const what = importLabel(item)
    return {
      key: `${item.file}:${item.name}:${item.from}`,
      label: showFile ? `${what} · ${fileBase(item.file)}` : what,
    }
  })
}

function PanelList({
  title,
  items,
  tone,
}: {
  title: string
  items: Array<{ key: string; label: string }>
  tone?: 'add' | 'edit' | 'remove'
}) {
  if (items.length === 0) return null
  const titleClass =
    tone === 'add'
      ? 'hud-section-title hud-section-title-add'
      : tone === 'edit'
        ? 'hud-section-title hud-section-title-edit'
        : tone === 'remove'
          ? 'hud-section-title hud-section-title-remove'
          : 'hud-section-title'
  const itemClass =
    tone === 'add'
      ? 'hud-file-add'
      : tone === 'edit'
        ? 'hud-file-edit'
        : tone === 'remove'
          ? 'hud-file-remove'
          : undefined
  return (
    <>
      <div className={titleClass}>{title}</div>
      <ul>
        {items.map((item) => (
          <li className={itemClass} key={item.key}>
            {item.label}
          </li>
        ))}
      </ul>
    </>
  )
}

function symbolChangeClass(kind: 'add' | 'edit' | null | undefined) {
  if (kind === 'add') return 'hud-file-add'
  if (kind === 'edit') return 'hud-file-edit'
  return undefined
}

function extraAddedSymbols(
  existing: Array<{ name: string }>,
  added: PatchSymbolAddition[],
) {
  const have = new Set(existing.map((item) => item.name))
  return added.filter((item) => !have.has(item.name))
}

function PatchSymbolChanges({
  title,
  added,
  changed,
}: {
  title: string
  added: PatchSymbolAddition[]
  changed: PatchSymbolAddition[]
}) {
  if (added.length === 0 && changed.length === 0) return null
  const addedNames = new Set(added.map((item) => item.name))
  return (
    <>
      <div className="hud-section-title">{title}</div>
      <ul>
        {changed
          .filter((item) => !addedNames.has(item.name))
          .map((item) => (
            <li className="hud-file-edit" key={`edit-${item.file}:${item.name}`}>
              {item.name}
            </li>
          ))}
        {added.map((item) => (
          <li className="hud-file-add" key={`add-${item.file}:${item.name}`}>
            {item.name}
          </li>
        ))}
      </ul>
    </>
  )
}

function MutationFold({
  hasContent,
  children,
}: {
  hasContent: boolean
  children: ReactNode
}) {
  if (!hasContent) return null
  return (
    <details
      className="hud-fold"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <summary className="hud-section-title hud-fold-summary">Mutations</summary>
      {children}
    </details>
  )
}

function AddIntentRow({
  placeholder,
  onAdd,
  pickLabel,
  pickActive = false,
  onTogglePick,
}: {
  placeholder: string
  onAdd: (value: string) => boolean
  pickLabel?: string
  pickActive?: boolean
  onTogglePick?: () => void
}) {
  const [value, setValue] = useState('')
  return (
    <form
      className="hud-add-row"
      onSubmit={(event) => {
        event.preventDefault()
        if (onAdd(value)) setValue('')
      }}
    >
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        spellCheck={false}
        onKeyDown={(event) => event.stopPropagation()}
      />
      <button className="hud-button" type="submit">
        Add
      </button>
      {onTogglePick && pickLabel && (
        <button
          className="hud-button"
          type="button"
          data-active={pickActive ? 'true' : undefined}
          aria-pressed={pickActive}
          onClick={onTogglePick}
        >
          {pickLabel}
        </button>
      )}
    </form>
  )
}

function BlueprintNoteModal({
  title,
  subtitle,
  value,
  placeholder,
  onChange,
  onClose,
}: {
  title: string
  subtitle: string
  value: string
  placeholder: string
  onChange: (value: string) => void
  onClose: () => void
}) {
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const release = beginKeyboardIsolation()
    document.exitPointerLock()
    const field = fieldRef.current
    field?.focus()
    if (field) {
      const end = field.value.length
      field.setSelectionRange(end, end)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (document.activeElement !== fieldRef.current) {
        fieldRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      release()
    }
  }, [])

  return (
    <div className="hud-note-overlay" onClick={onClose}>
      <div
        className="hud-note-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hud-note-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="hud-note-header">
          <div className="hud-note-heading">
            <h1 id="hud-note-title">{title}</h1>
            <p className="hud-note-subtitle">{subtitle}</p>
          </div>
          <button className="hud-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <textarea
          ref={fieldRef}
          className="hud-note-field"
          data-blueprint-note="true"
          defaultValue={value}
          maxLength={8000}
          placeholder={placeholder}
          aria-label={title}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          autoFocus
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  )
}

function BlueprintSymbolRow({
  name,
  className,
  hasNote,
  noteOpen,
  canEdit,
  canRemove,
  onRemove,
  onOpenNote,
  onExplain,
  pointerTarget,
  colorPointers,
  currentColorId,
  onTogglePoint,
}: {
  name: string
  className?: string
  hasNote: boolean
  noteOpen?: boolean
  canEdit: boolean
  canRemove?: boolean
  onRemove?: () => void
  onOpenNote: () => void
  onExplain?: () => void
  pointerTarget?: {
    kind: BlueprintPointerKind
    path: string
    name: string
  }
  colorPointers?: BlueprintColorOption[]
  currentColorId?: string | null
  onTogglePoint?: (color?: string) => void
}) {
  const showActions = Boolean(onExplain) || canEdit
  return (
    <li>
      <span className={className}>{name}</span>
      {showActions && (
        <div className="hud-item-actions">
          {onExplain ? (
            <ExplainButton
              compact
              label={`Explain ${name}`}
              onClick={onExplain}
            />
          ) : null}
          {canEdit && onTogglePoint && pointerTarget && (
            <PointColorControl
              compact
              target={pointerTarget}
              colorPointers={colorPointers}
              currentColorId={currentColorId}
              idleLabel={`Point to ${name}`}
              pointedLabel={`Stop pointing to ${name}`}
              onToggle={onTogglePoint}
            />
          )}
          {canEdit && (
            <button
              className="hud-item-note"
              type="button"
              data-has-note={hasNote ? 'true' : 'false'}
              data-open={noteOpen ? 'true' : 'false'}
              aria-label={`Edit note for ${name}`}
              onClick={onOpenNote}
            >
              Note
            </button>
          )}
          {canEdit && canRemove && (
            <button
              className="hud-item-remove"
              type="button"
              aria-label={`Remove ${name}`}
              onClick={onRemove}
            >
              ×
            </button>
          )}
        </div>
      )}
    </li>
  )
}

function AttachStateBadge({ attached }: { attached: boolean }) {
  return (
    <span
      className="hud-attach-badge"
      data-attached={attached}
      aria-label={attached ? 'LLM attached' : 'Waiting for LLM'}
    >
      <span className="hud-attach-dot" aria-hidden="true" />
      {attached ? 'Attached' : 'Waiting'}
    </span>
  )
}

function ExplainButton({
  label,
  onClick,
  compact = false,
}: {
  label: string
  onClick: () => void
  compact?: boolean
}) {
  return (
    <button
      className={
        compact
          ? 'hud-explain-button hud-explain-inline'
          : 'hud-explain-button'
      }
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      ?
    </button>
  )
}

function PanelChrome({
  title,
  subtitle,
  badge,
  minimized = false,
  onMinimize,
  onClose,
  onExplain,
  explainLabel,
}: {
  title: ReactNode
  subtitle?: ReactNode
  badge?: ReactNode
  minimized?: boolean
  onMinimize?: () => void
  onClose?: () => void
  onExplain?: () => void
  explainLabel?: string
}) {
  return (
    <div className="hud-panel-chrome">
      <div className="hud-panel-chrome-heading">
        <div className="hud-panel-chrome-title-row">
          <div className="hud-panel-chrome-title">
            {title}
            {onExplain ? (
              <ExplainButton
                label={explainLabel ?? 'Explain'}
                onClick={onExplain}
              />
            ) : null}
          </div>
          {badge}
        </div>
        {subtitle ? (
          <div className="hud-panel-chrome-subtitle">{subtitle}</div>
        ) : null}
      </div>
      <div className="hud-panel-controls">
        {onMinimize && (
          <button
            className="hud-button hud-icon-button hud-panel-control"
            type="button"
            aria-label={minimized ? 'Restore' : 'Minimize'}
            onClick={onMinimize}
          >
            {minimized ? '+' : '−'}
          </button>
        )}
        {onClose && (
          <button
            className="hud-button hud-icon-button hud-panel-control"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}

function blueprintIsDefined(intent: AgentIntent) {
  return (
    Boolean(intent.localBlueprintEnabled) ||
    (intent.userCreatedBlocks?.length ?? 0) > 0 ||
    (intent.userCreatedIslands?.length ?? 0) > 0 ||
    (intent.blueprintFunctions?.length ?? 0) > 0 ||
    (intent.blueprintVariables?.length ?? 0) > 0 ||
    (intent.blueprintImports?.length ?? 0) > 0 ||
    (intent.blueprintNotes?.length ?? 0) > 0 ||
    (intent.blueprintPointers?.length ?? 0) > 0
  )
}

function HandshakeSetup({
  blueprintDefined,
  awaitingAttach,
  nextAttachLabel,
  colorCommand,
}: {
  blueprintDefined: boolean
  awaitingAttach: boolean
  nextAttachLabel: string | null
  colorCommand?: string | null
}) {
  return (
    <div className="hud-setup">
      <section className="hud-setup-section">
        <h2 className="hud-setup-heading">
          Blueprint
          <span
            className="hud-setup-tag"
            data-ready={blueprintDefined ? 'true' : 'false'}
          >
            {blueprintDefined ? 'blueprint defined' : 'no blueprint'}
          </span>
        </h2>
        <p>
          Right-click to create files and folders. Open a file's
          info panel to add functions, vars, and notes (instructions or
          pseudo code). Every chat receives the global (blue) blueprint plus
          this session's color.
        </p>
      </section>
      <section className="hud-setup-section">
        <h2 className="hud-setup-heading">Start</h2>
        {awaitingAttach && nextAttachLabel ? (
          <>
            <p>
              The next Cursor chat connects to {nextAttachLabel} first. This
              session stays in the queue.
            </p>
            <ColorConnectHint colorCommand={colorCommand} queued />
          </>
        ) : awaitingAttach ? (
          <>
            <p>
              Open a Cursor chat to connect and start. A regular chat takes
              the next empty slot.
            </p>
            <ColorConnectHint colorCommand={colorCommand} />
          </>
        ) : (
          <p>This window is attached. Starting from the Cursor chat…</p>
        )}
      </section>
    </div>
  )
}

function sessionLiveStatus(intent: AgentIntent) {
  const ack = intent.lastAck
  const kind = ack?.kind
  const detail = ack?.detail?.trim() || ''

  if (intent.status === 'finished' || kind === 'finished') {
    return { text: 'Finished', busy: false }
  }
  if (kind === 'stopped' || intent.status === 'rejected') {
    return { text: 'Stopped', busy: false }
  }
  if (kind === 'timeout') {
    return { text: 'LLM wait timed out', busy: false }
  }
  if (intent.awaitingAttach) {
    return { text: 'Waiting for a Cursor chat', busy: false }
  }
  if (intent.llmIdle) {
    return { text: 'LLM disconnected', busy: false }
  }
  if (intent.pendingExplain) {
    return { text: 'Starting an explanation…', busy: true }
  }
  if (kind === 'explain' && !intent.listening) {
    return { text: 'LLM is explaining this proposal on the map', busy: true }
  }
  if (intent.status === 'pending') {
    return intent.listening
      ? { text: 'LLM is listening — accept or send an instruction', busy: false }
      : { text: 'Review this step', busy: false }
  }
  if (kind === 'execute') {
    return { text: `LLM received ${detail}`, busy: true }
  }
  if (kind === 'invoke') {
    return { text: `Sent ${detail} — waiting for LLM`, busy: true }
  }
  if (kind === 'replan') {
    return { text: 'LLM received a new instruction', busy: true }
  }
  if (intent.status === 'working') {
    return {
      text: intent.reason
        ? `LLM is working on ${intent.reason}`
        : 'LLM is working',
      busy: true,
    }
  }
  if (intent.status === 'replanning') {
    return { text: 'LLM is revising the plan', busy: true }
  }
  if (intent.status === 'preparing' || kind === 'blueprint') {
    return { text: 'LLM is drafting the plan', busy: true }
  }
  if (kind === 'plan' || intent.status === 'planned') {
    return intent.listening
      ? { text: 'LLM is listening — run the next step', busy: false }
      : { text: 'Plan ready', busy: false }
  }
  if (
    kind === 'attached' ||
    intent.status === 'blueprint' ||
    intent.status === 'blueprint_ask'
  ) {
    return { text: 'LLM attached', busy: true }
  }
  return { text: 'LLM connected', busy: true }
}

function LiveStatus({
  intent,
  showStop = false,
  onStop,
  startingExplain = false,
}: {
  intent: AgentIntent
  showStop?: boolean
  onStop?: () => void
  startingExplain?: boolean
}) {
  const status = startingExplain && !intent.pendingExplain
    ? { text: 'Starting an explanation…', busy: true }
    : sessionLiveStatus(intent)
  const [flash, setFlash] = useState(false)
  const lastAt = intent.lastAck?.at

  useEffect(() => {
    if (!lastAt) return
    setFlash(true)
    const timer = window.setTimeout(() => setFlash(false), 700)
    return () => window.clearTimeout(timer)
  }, [lastAt])

  return (
    <div className="hud-live" data-busy={status.busy} data-flash={flash}>
      {status.busy ? <span className="hud-spinner" aria-hidden="true" /> : null}
      <span>{status.text}</span>
      {showStop && onStop ? (
        <button
          className="hud-button hud-button-reject"
          type="button"
          onClick={onStop}
        >
          Stop
        </button>
      ) : null}
    </div>
  )
}

function PlaceFilesHint() {
  return (
    <p className="hud-place-hint">Right-click to create files and folders.</p>
  )
}

type SessionPanelProps = {
  intent: AgentIntent
  focused: boolean
  naming: boolean
  nextAttachSession?: AgentIntent | null
  onFocus: () => void
  onWorkflowAction: (
    sessionId: string,
    action: WorkflowAction,
    options?: { instruction?: string; step?: number; stepByStep?: boolean },
  ) => void
  onNavigateDiff: (sessionId: string, diffId: string) => void
}

function SessionPanel({
  intent,
  focused,
  naming,
  nextAttachSession = null,
  onFocus,
  onWorkflowAction,
  onNavigateDiff,
}: SessionPanelProps) {
  const [minimized, setMinimized] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [startingExplain, setStartingExplain] = useState(false)
  const sessionId = intent.sessionId
  const latestEntry = intent.isActiveDiff ? intent.chain.at(-1) : null
  const pending =
    latestEntry?.status === 'pending' ||
    (intent.status === 'pending' && intent.isActiveDiff)
  const askingBlueprint = intent.status === 'blueprint_ask'
  const sendingBlueprint = intent.status === 'blueprint'
  const canPlace = Boolean(intent.creationMode)
  const preparing = intent.status === 'preparing'
  const working = intent.status === 'working' || intent.status === 'replanning'
  const planReady = intent.status === 'planned' && !pending
  const previewing = intent.preview
  const chainIndex = intent.chainIndex ?? 0
  const previousDiff = intent.chain[chainIndex - 1]
  const nextDiff = intent.chain[chainIndex + 1]
  const stepLabel =
    intent.step && intent.steps?.length > 0
      ? `Step ${intent.step} of ${intent.steps.length}`
      : 'Patch'
  const stepByStep = intent.stepByStep !== false
  const addedFunctions = intent.addedFunctions ?? []
  const addedVariables = intent.addedVariables ?? []
  const addedImports = intent.addedImports ?? []
  const changedFunctions = intent.changedFunctions ?? []
  const changedVariables = intent.changedVariables ?? []
  const acceptedSteps = new Set(
    intent.status === 'finished'
      ? intent.steps.map((step) => step.index)
      : intent.chain
          .filter((entry) => entry.status === 'applied')
          .map((entry) => entry.step),
  )
  if (intent.status === 'approved' && typeof intent.step === 'number') {
    acceptedSteps.add(intent.step)
  }
  const proposalStep = pending
    ? (latestEntry?.status === 'pending' ? latestEntry.step : intent.step)
    : null
  const processingStep =
    working && typeof intent.step === 'number' ? intent.step : null
  const invokeStep =
    planReady && !working && proposalStep === null
      ? (intent.steps.find((step) => !acceptedSteps.has(step.index)) ?? null)
      : null
  const llmDisconnected =
    Boolean(intent.llmIdle) && intent.awaitingAttach === false
  const canRunNext = stepByStep && Boolean(invokeStep) && !llmDisconnected
  const canAcceptProposal = proposalStep !== null && !llmDisconnected
  const lastStep =
    typeof proposalStep === 'number' &&
    intent.steps.length > 0 &&
    proposalStep >= intent.steps.length
  const panelDone =
    intent.status === 'finished' ||
    intent.status === 'approved' ||
    acceptedSteps.size > 0 ||
    canAcceptProposal

  useEffect(() => {
    setInstruction('')
    setStartingExplain(false)
  }, [intent.diffId, sessionId])

  useEffect(() => {
    if (intent.pendingExplain) setStartingExplain(false)
  }, [intent.pendingExplain])

  if (!sessionId || !isReviewingIntent(intent.status)) return null

  const handshakeSetup =
    Boolean(intent.awaitingAttach) &&
    (askingBlueprint || sendingBlueprint || preparing)
  const llmConnected = intent.awaitingAttach === false
  const showConnectedProgress =
    llmConnected && !llmDisconnected && (askingBlueprint || sendingBlueprint || preparing)
  const showPlaceHint =
    canPlace && !intent.working && !askingBlueprint && !sendingBlueprint
  const liveHasStop = showConnectedProgress || working || llmDisconnected
  const queuedBehind =
    intent.awaitingAttach &&
    nextAttachSession &&
    nextAttachSession.sessionId !== sessionId
      ? sessionDisplayName(nextAttachSession) || 'an earlier session'
      : null

  const act = (
    action: WorkflowAction,
    options?: { instruction?: string; step?: number; stepByStep?: boolean },
  ) => onWorkflowAction(sessionId, action, options)

  return (
    <aside
      className={
        panelDone
          ? 'hud-panel hud-panel-planned hud-panel-done'
          : 'hud-panel hud-panel-planned'
      }
      data-minimized={minimized}
      data-focused={focused}
      data-attached={llmConnected && !llmDisconnected}
      onPointerDown={onFocus}
    >
      <PanelChrome
        title={
          <>
            <SessionSwatch colorHex={intent.colorHex} />
            <span className="hud-panel-chrome-title-text">
              {sessionDisplayName(intent) ||
                (showConnectedProgress
                  ? 'LLM connected'
                  : reviewTitle(intent.status))}
            </span>
          </>
        }
        subtitle={
          sessionLabel(intent)
            ? showConnectedProgress
              ? 'LLM connected'
              : reviewTitle(intent.status)
            : sessionColorName(intent)
              ? showConnectedProgress
                ? 'LLM connected'
                : reviewTitle(intent.status)
              : undefined
        }
        badge={<AttachStateBadge attached={llmConnected && !llmDisconnected} />}
        minimized={minimized}
        onMinimize={() => setMinimized((current) => !current)}
      />
      {!minimized && (
        <>
          {!intent.awaitingAttach && (
            <>
              {showPlaceHint && !planReady && !pending && <PlaceFilesHint />}
              <LiveStatus
                intent={intent}
                showStop={liveHasStop}
                startingExplain={startingExplain}
                onStop={() => act('stop')}
              />
            </>
          )}
          {!llmDisconnected && (
            <label className="hud-mode-switch">
              <span>Step by step</span>
              <button
                className="hud-switch"
                type="button"
                role="switch"
                aria-checked={stepByStep}
                aria-label="Step by step"
                onKeyDown={(event) => event.stopPropagation()}
                onClick={() => act('set_step_by_step', { stepByStep: !stepByStep })}
              />
            </label>
          )}
          {!llmDisconnected && !stepByStep && (
            <p className="hud-mode-hint">
              LLM implements the full plan. You can still walk the diffs, then
              Accept proposal.
            </p>
          )}
          {handshakeSetup ? (
            <HandshakeSetup
              blueprintDefined={blueprintIsDefined(intent)}
              awaitingAttach={Boolean(intent.awaitingAttach)}
              nextAttachLabel={queuedBehind}
              colorCommand={sessionSlashCommand(intent)}
            />
          ) : intent.awaitingAttach ? (
            queuedBehind ? (
              <div className="hud-mode-hint">
                <p>
                  The next Cursor chat connects to {queuedBehind} first. This
                  session stays in the queue.
                </p>
                <ColorConnectHint
                  colorCommand={sessionSlashCommand(intent)}
                  queued
                />
              </div>
            ) : (
              <div className="hud-mode-hint">
                <p>
                  No LLM is attached. Open a Cursor chat — it connects to the
                  next waiting session.
                </p>
                <ColorConnectHint colorCommand={sessionSlashCommand(intent)} />
              </div>
            )
          ) : null}
          {llmDisconnected ? (
            <p className="hud-mode-hint">
              This chat is no longer connected. The session will reset.
            </p>
          ) : null}
          {intent.feature &&
            !handshakeSetup &&
            intent.feature.trim() !== sessionLabel(intent) && (
              <p className="hud-feature">{intent.feature}</p>
            )}
          {askingBlueprint && !handshakeSetup && !showConnectedProgress && !llmDisconnected ? (
            <>
              <p>
                This chat receives the global (blue) blueprint and this
                session's color. Send it to the LLM, or skip and let it
                continue with the current layout.
              </p>
              <div className="hud-decide">
                <button
                  className="hud-button hud-button-approve"
                  type="button"
                  onClick={() => act('blueprint_yes')}
                >
                  Create blueprint
                </button>
                <button
                  className="hud-button hud-button-approve"
                  type="button"
                  onClick={() => act('blueprint_no')}
                >
                  Let LLM continue
                </button>
                <button
                  className="hud-button hud-button-reject"
                  type="button"
                  onClick={() => act('stop')}
                >
                  Stop
                </button>
              </div>
            </>
          ) : handshakeSetup ? null : intent.status === 'finished' ? (
            <p>All plan steps were applied.</p>
          ) : showConnectedProgress || preparing ? null : (
            <p className="hud-step-label">
              {stepLabel}
              {intent.reason ? ` · ${intent.reason}` : ''}
            </p>
          )}
          {!askingBlueprint && !sendingBlueprint && (
            <>
              {intent.steps?.length > 0 && (
                <ol className="hud-steps">
                  {intent.steps.map((step) => {
                    const proposed = proposalStep === step.index
                    const processing = processingStep === step.index
                    const accepted = acceptedSteps.has(step.index) && !proposed
                    const creating = processing && !proposed
                    const explaining =
                      startingExplain || Boolean(intent.pendingExplain)
                    const showStepAction =
                      creating ||
                      (canRunNext && invokeStep?.index === step.index) ||
                      (canAcceptProposal && proposed)
                    return (
                      <li
                        key={step.index}
                        data-done={accepted || proposed}
                        data-active={processing || proposed}
                      >
                        <span className="hud-step-index">{step.index}.</span>
                        <span className="hud-step-main">
                          <span className="hud-step-title">{step.title}</span>
                          {showStepAction && (
                            <span className="hud-step-actions">
                              <button
                                className="hud-button hud-button-approve hud-run-step"
                                type="button"
                                disabled={creating}
                                aria-busy={creating}
                                onClick={() =>
                                  proposed
                                    ? lastStep
                                      ? act('continue')
                                      : act('invoke', {
                                          step: step.index + 1,
                                        })
                                    : act('invoke', {
                                        step: step.index,
                                      })
                                }
                              >
                                {proposed
                                  ? 'Accept proposal'
                                  : creating
                                    ? 'Creating proposal…'
                                    : 'Create proposal'}
                              </button>
                              {!creating && (
                                <button
                                  className="hud-button hud-button-approve hud-run-step"
                                  type="button"
                                  disabled={explaining}
                                  aria-busy={explaining}
                                  onClick={() => {
                                    setStartingExplain(true)
                                    void Promise.resolve(
                                      onWorkflowAction(
                                        sessionId,
                                        'explain_proposal',
                                      ),
                                    ).then((ok) => {
                                      if (ok === false) setStartingExplain(false)
                                    })
                                  }}
                                >
                                  {explaining
                                    ? 'Starting explanation…'
                                    : 'Explain proposal'}
                                </button>
                              )}
                            </span>
                          )}
                        </span>
                      </li>
                    )
                  })}
                </ol>
              )}
              {intent.chain.length > 0 && (
                <div className="hud-chain">
                  <button
                    className="hud-button"
                    type="button"
                    disabled={!previousDiff}
                    onClick={() =>
                      previousDiff && onNavigateDiff(sessionId, previousDiff.id)
                    }
                  >
                    Previous
                  </button>
                  <span>
                    Diff {chainIndex + 1} of {intent.chain.length}
                  </span>
                  <button
                    className="hud-button"
                    type="button"
                    disabled={!nextDiff}
                    onClick={() =>
                      nextDiff && onNavigateDiff(sessionId, nextDiff.id)
                    }
                  >
                    Next
                  </button>
                </div>
              )}
              <MutationFold
                hasContent={
                  previewing &&
                  (intent.files.length > 0 ||
                    (intent.createFolders ?? []).length > 0 ||
                    intent.creates.length > 0 ||
                    intent.deletes.length > 0 ||
                    addedFunctions.length > 0 ||
                    addedVariables.length > 0 ||
                    addedImports.length > 0 ||
                    changedFunctions.length > 0 ||
                    changedVariables.length > 0 ||
                    (intent.imports ?? []).length > 0)
                }
              >
                {intent.files.length > 0 && (
                  <>
                    <div className="hud-section-title hud-section-title-edit">
                      Changed
                    </div>
                    <ul>
                      {intent.files.map((id) => (
                        <li className="hud-file-edit" key={id}>
                          {id}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {(intent.createFolders ?? []).length > 0 && (
                  <>
                    <div className="hud-section-title hud-section-title-add">
                      Added folders
                    </div>
                    <ul>
                      {intent.createFolders.map((id) => (
                        <li className="hud-file-add" key={id}>
                          {id}/
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {intent.creates.length > 0 && (
                  <>
                    <div className="hud-section-title hud-section-title-add">
                      Added
                    </div>
                    <ul>
                      {intent.creates.map((id) => (
                        <li className="hud-file-add" key={id}>
                          {id}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {intent.deletes.length > 0 && (
                  <>
                    <div className="hud-section-title hud-section-title-remove">
                      Removed
                    </div>
                    <ul>
                      {intent.deletes.map((id) => (
                        <li className="hud-file-remove" key={id}>
                          {id}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <PanelList
                  title="Changed functions"
                  items={symbolLabels(changedFunctions)}
                  tone="edit"
                />
                <PanelList
                  title="Added functions"
                  items={symbolLabels(addedFunctions)}
                  tone="add"
                />
                <PanelList
                  title="Changed variables"
                  items={symbolLabels(changedVariables)}
                  tone="edit"
                />
                <PanelList
                  title="Added variables"
                  items={symbolLabels(addedVariables)}
                  tone="add"
                />
                {addedImports.length > 0 && (
                  <PanelList title="Imports" items={importLabels(addedImports)} />
                )}
                {addedImports.length === 0 && (intent.imports ?? []).length > 0 && (
                  <>
                    <div className="hud-section-title">Imports</div>
                    <ul>
                      {intent.imports.map((edge) => (
                        <li key={`${edge.from}->${edge.to}`}>
                          {edge.from.split('/').pop()} → {edge.to.split('/').pop()}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </MutationFold>
              {planReady && (
                <div className="hud-session-actions">
                  {showPlaceHint && <PlaceFilesHint />}
                  <div className="hud-decide">
                    <button
                      className="hud-button hud-button-reject"
                      type="button"
                      onClick={() => act('stop')}
                    >
                      Stop
                    </button>
                  </div>
                </div>
              )}
              {pending && !llmDisconnected && (
                <>
                  <label className="hud-instruction">
                    <span>Alternative instruction for the LLM</span>
                    <textarea
                      value={instruction}
                      maxLength={4000}
                      rows={3}
                      placeholder="Describe what should change in this proposal…"
                      onChange={(event) => setInstruction(event.target.value)}
                      onKeyDown={(event) => event.stopPropagation()}
                    />
                  </label>
                  <div className="hud-session-actions">
                    {showPlaceHint && <PlaceFilesHint />}
                    <div className="hud-decide">
                      <button
                        className="hud-button hud-button-extend"
                        type="button"
                        disabled={!instruction.trim()}
                        onClick={() =>
                          act('instruct', { instruction })
                        }
                      >
                        Send instruction
                      </button>
                      <button
                        className="hud-button hud-button-reject"
                        type="button"
                        onClick={() => act('stop')}
                      >
                        Stop
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </aside>
  )
}

function BranchChangesPanel({
  changes,
}: {
  changes: BranchChanges
}) {
  const [minimized, setMinimized] = useState(false)
  const addedFunctions = changes.addedFunctions ?? []
  const addedVariables = changes.addedVariables ?? []
  const addedImports = changes.addedImports ?? []
  const changedFunctions = changes.changedFunctions ?? []
  const changedVariables = changes.changedVariables ?? []
  const subtitle =
    changes.branch && changes.base
      ? `${changes.branch} vs ${changes.base}`
      : changes.branch
        ? changes.branch
        : null
  const hasContent =
    changes.files.length > 0 ||
    (changes.createFolders ?? []).length > 0 ||
    changes.creates.length > 0 ||
    changes.deletes.length > 0 ||
    addedFunctions.length > 0 ||
    addedVariables.length > 0 ||
    addedImports.length > 0 ||
    changedFunctions.length > 0 ||
    changedVariables.length > 0 ||
    (changes.imports ?? []).length > 0

  return (
    <aside
      className="hud-panel hud-panel-planned hud-panel-done"
      data-minimized={minimized}
    >
      <PanelChrome
        title="Branch changes"
        minimized={minimized}
        onMinimize={() => setMinimized((current) => !current)}
      />
      {!minimized && (
        <>
          {subtitle && <p className="hud-feature">{subtitle}</p>}
          {!hasContent ? (
            <p>No file changes on this branch.</p>
          ) : (
            <MutationFold hasContent>
              {changes.files.length > 0 && (
                <>
                  <div className="hud-section-title hud-section-title-edit">
                    Changed
                  </div>
                  <ul>
                    {changes.files.map((id) => (
                      <li className="hud-file-edit" key={id}>
                        {id}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {(changes.createFolders ?? []).length > 0 && (
                <>
                  <div className="hud-section-title hud-section-title-add">
                    Added folders
                  </div>
                  <ul>
                    {changes.createFolders.map((id) => (
                      <li className="hud-file-add" key={id}>
                        {id}/
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {changes.creates.length > 0 && (
                <>
                  <div className="hud-section-title hud-section-title-add">
                    Added
                  </div>
                  <ul>
                    {changes.creates.map((id) => (
                      <li className="hud-file-add" key={id}>
                        {id}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {changes.deletes.length > 0 && (
                <>
                  <div className="hud-section-title hud-section-title-remove">
                    Removed
                  </div>
                  <ul>
                    {changes.deletes.map((id) => (
                      <li className="hud-file-remove" key={id}>
                        {id}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <PatchSymbolChanges
                title="Functions"
                added={addedFunctions}
                changed={changedFunctions}
              />
              <PatchSymbolChanges
                title="Vars"
                added={addedVariables}
                changed={changedVariables}
              />
              <PanelList
                title="Imports"
                items={importLabels(addedImports)}
                tone="add"
              />
            </MutationFold>
          )}
        </>
      )}
    </aside>
  )
}

type ExplorerInstruction = {
  id: string
  keys: string[]
  label: string
}

type InstructionView = 'walk' | 'map'

type ExplorerInstructionSection = {
  id: InstructionView
  title: string
  items: ExplorerInstruction[]
}

function InstructionList({ items }: { items: ExplorerInstruction[] }) {
  return (
    <ul className="hud-instructions-list">
      {items.map((hint) => (
        <li className="hud-instruction" key={hint.id}>
          {hint.keys.length > 0 && (
            <span className="hud-instruction-keys">
              {hint.keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </span>
          )}
          <span className="hud-instruction-label">{hint.label}</span>
        </li>
      ))}
    </ul>
  )
}

function explorerInstructions({
  canPlace,
  hasChangeSet,
  changePathsOnly,
  selectedUserCreated,
  infoVisible,
  importedBy,
  showBranchChanges,
  canShowBranchChanges,
}: {
  canPlace: boolean
  hasChangeSet: boolean
  changePathsOnly: boolean
  selectedUserCreated: boolean
  infoVisible: boolean
  importedBy: boolean
  showBranchChanges: boolean
  canShowBranchChanges: boolean
}): ExplorerInstructionSection[] {
  const backspace: ExplorerInstruction[] =
    selectedUserCreated && canPlace
      ? [{ id: 'backspace', keys: ['Backspace'], label: 'Delete' }]
      : []
  const info: ExplorerInstruction[] = [
    {
      id: 'info',
      keys: ['I'],
      label: infoVisible ? 'Hide info' : 'Show info',
    },
    ...(infoVisible
      ? [{ id: 'scroll-info', keys: ['↑', '↓'], label: 'Scroll info' }]
      : []),
  ]
  const imported: ExplorerInstruction = {
    id: 'imported',
    keys: ['K'],
    label: importedBy ? 'Show imports' : 'Show imported by',
  }
  const branch: ExplorerInstruction[] = canShowBranchChanges
    ? [
        {
          id: 'branch-changes',
          keys: ['G'],
          label: showBranchChanges
            ? 'Hide branch changes'
            : 'Show branch changes',
        },
      ]
    : []
  return [
    {
      id: 'walk',
      title: 'Walk',
      items: [
        { id: 'wasd', keys: ['W', 'A', 'S', 'D'], label: 'Walk' },
        { id: 'mouse-look', keys: ['Mouse'], label: 'Look around' },
        { id: 'shift', keys: ['Shift'], label: 'Sprint' },
        ...(canPlace
          ? [
              {
                id: 'point-to',
                keys: ['Point to'],
                label: 'Keep a file, folder, or function in mind',
              },
            ]
          : []),
        ...backspace,
        {
          id: 'dblclick-info',
          keys: ['Double-click'],
          label: 'A file or folder for info',
        },
        { id: 'aim-line', keys: ['Click'], label: 'Aim a line to fly' },
        ...info,
        imported,
        ...branch,
        {
          id: 'update-model',
          keys: ['Update model'],
          label: 'Rescan files and folders',
        },
        {
          id: 'cursor-chat',
          keys: ['Cursor chat'],
          label:
            'Connects to the next empty session, or /coral /amber /lime /orange /violet for that color; /explain for explain mode; 5 chats at once',
        },
        {
          id: 'blueprint-select',
          keys: ['Blueprint colors'],
          label:
            'All colors stay visible; the selected color is where new files go',
        },
        {
          id: 'blueprint-toggle',
          keys: ['Hide/Show'],
          label: 'Hide this color; other blueprint colors stay visible',
        },
        {
          id: 'blueprint-clear',
          keys: ['Clear'],
          label: 'Remove every planned file and folder',
        },
        {
          id: 'blueprint-cleanup',
          keys: ['Cleanup'],
          label: 'Drop blueprint files and folders that already exist',
        },
        { id: 'toggle-map', keys: ['M'], label: 'Toggle map' },
        {
          id: 'release',
          keys: ['Double-click', 'Esc'],
          label: 'Release mouse',
        },
      ],
    },
    {
      id: 'map',
      title: 'Map',
      items: [
        { id: 'scroll-zoom', keys: ['Scroll'], label: 'Zoom' },
        { id: 'drag-pan', keys: ['Drag'], label: 'Pan' },
        { id: 'click-block', keys: ['Click'], label: 'A file for info' },
        {
          id: 'click-island',
          keys: ['Click'],
          label: 'A folder for its files',
        },
        ...(canPlace
          ? [
              { id: 'select-island', keys: ['Click'], label: 'Select a folder' },
              {
                id: 'add-file-folder',
                keys: ['Right-click'],
                label: 'Create a file or folder, or point to a folder',
              },
            ]
          : []),
        {
          id: 'option-click-walk',
          keys: ['Option', 'Click'],
          label: 'A folder to walk',
        },
        {
          id: 'gold-pin',
          keys: [],
          label: 'Gold pin is your walk position',
        },
        ...(hasChangeSet
          ? [
              {
                id: 'toggle-paths',
                keys: ['C'],
                label: changePathsOnly
                  ? 'Show all paths'
                  : 'Show only changed paths',
              },
            ]
          : []),
        ...backspace,
        ...info,
        imported,
        ...branch,
        {
          id: 'update-model',
          keys: ['Update model'],
          label: 'Rescan files and folders',
        },
        {
          id: 'cursor-chat',
          keys: ['Cursor chat'],
          label:
            'Connects to the next empty session, or /coral /amber /lime /orange /violet for that color; /explain for explain mode; 5 chats at once',
        },
        {
          id: 'blueprint-select',
          keys: ['Blueprint colors'],
          label:
            'All colors stay visible; the selected color is where new files go',
        },
        {
          id: 'blueprint-toggle',
          keys: ['Hide/Show'],
          label: 'Hide this color; other blueprint colors stay visible',
        },
        {
          id: 'blueprint-clear',
          keys: ['Clear'],
          label: 'Remove every planned file and folder',
        },
        {
          id: 'blueprint-cleanup',
          keys: ['Cleanup'],
          label: 'Drop blueprint files and folders that already exist',
        },
        { id: 'map-walk', keys: ['M'], label: 'Back to walk' },
      ],
    },
  ]
}

type HUDProps = {
  graph: CodebaseGraph
  mode: ViewMode
  locked: boolean
  selectedId: string | null
  selectedTick?: number
  inspectTick?: number
  selectedFolder?: string | null
  aimedRelation: AimedRelation | null
  aimedFileId?: string | null
  intent: AgentIntent
  intents?: AgentIntent[]
  focusedSessionId?: string | null
  nextAttachSessionId?: string | null
  onFocusSession?: (sessionId: string) => void
  onWorkflowAction: (
    sessionId: string,
    action: WorkflowAction,
    options?: { instruction?: string; step?: number; stepByStep?: boolean },
  ) => void
  onNavigateDiff: (sessionId: string, diffId: string) => void
  onOpenMap: () => void
  onWalk: () => void
  showBranchChanges?: boolean
  branchChanges?: BranchChanges
  canShowBranchChanges?: boolean
  llmMakingChanges?: boolean
  onToggleShowBranchChanges?: () => void
  onUpdateModel: () => void
  updatingModel?: boolean
  importedBy: boolean
  onToggleImportedBy: () => void
  changePathsOnly?: boolean
  hasChangeSet?: boolean
  onToggleChangePathsOnly?: () => void
  naming?: boolean
  namingIsland?: boolean
  onCommitIslandName?: (name: string) => void
  onCancelIslandName?: () => void
  blueprintFunctions?: PatchSymbolAddition[]
  blueprintVariables?: PatchSymbolAddition[]
  blueprintImports?: PatchImportAddition[]
  blueprintNotes?: BlueprintNote[]
  blueprintPointers?: BlueprintPointer[]
  onAddBlueprintFunction?: (fileId: string, name: string) => boolean
  onAddBlueprintVariable?: (fileId: string, name: string) => boolean
  onAddBlueprintImport?: (fileId: string, raw: string) => boolean
  importPickActive?: boolean
  onToggleImportPick?: () => void
  onCancelImportPick?: () => void
  onRemoveBlueprintFunction?: (fileId: string, name: string) => void
  onRemoveBlueprintVariable?: (fileId: string, name: string) => void
  onRemoveBlueprintImport?: (
    fileId: string,
    name: string,
    from: string,
  ) => void
  onSetBlueprintNote?: (next: {
    file: string
    kind: BlueprintNoteKind
    name?: string
    note: string
  }) => void
  onToggleBlueprintPointer?: (next: {
    kind: BlueprintPointerKind
    path: string
    name?: string
    color?: string
  }) => void
  onMapAddFile?: (folderPath: string) => void
  onMapAddFolder?: (folderPath: string) => void
  onRenameCreatedFile?: (fileId: string, name: string) => string | null
  onInspectFile?: (fileId: string) => void
  onInspectBlock?: (fileId: string) => void
  onExplainTarget?: (input: {
    kind: ExplainTargetKind
    path: string
    name?: string
  }) => void
  blueprintHidden?: boolean
  blueprintHasContent?: boolean
  blueprintCanCleanup?: boolean
  blueprintColor?: string | null
  blueprintOptions?: BlueprintOption[]
  blueprintColorPointers?: BlueprintColorOption[]
  onSelectBlueprintColor?: (color: string) => void
  onToggleBlueprintHidden?: () => void
  onClearBlueprint?: () => void
  onCleanupBlueprint?: () => void
  devTargets?: DevTargetsState
  onSelectDevTarget?: (id: string) => void
}

export function HUD({
  graph,
  mode,
  locked,
  selectedId,
  selectedTick = 0,
  inspectTick = 0,
  selectedFolder = null,
  aimedRelation,
  aimedFileId = null,
  intent,
  intents,
  focusedSessionId = null,
  nextAttachSessionId = null,
  onFocusSession,
  onWorkflowAction,
  onNavigateDiff,
  onOpenMap,
  onWalk,
  showBranchChanges = false,
  branchChanges,
  canShowBranchChanges = false,
  llmMakingChanges = false,
  onToggleShowBranchChanges,
  onUpdateModel,
  updatingModel = false,
  importedBy,
  onToggleImportedBy,
  changePathsOnly = false,
  hasChangeSet = false,
  onToggleChangePathsOnly,
  naming = false,
  namingIsland = false,
  onCommitIslandName,
  onCancelIslandName,
  blueprintFunctions = [],
  blueprintVariables = [],
  blueprintImports = [],
  blueprintNotes = [],
  onAddBlueprintFunction,
  onAddBlueprintVariable,
  onAddBlueprintImport,
  importPickActive = false,
  onToggleImportPick,
  onCancelImportPick,
  onRemoveBlueprintFunction,
  onRemoveBlueprintVariable,
  onRemoveBlueprintImport,
  onSetBlueprintNote,
  onToggleBlueprintPointer,
  onMapAddFile,
  onMapAddFolder,
  onRenameCreatedFile,
  onInspectFile,
  onInspectBlock,
  onExplainTarget,
  blueprintHidden = false,
  blueprintHasContent = false,
  blueprintCanCleanup = false,
  blueprintColor = null,
  blueprintOptions = [],
  blueprintColorPointers = [],
  onSelectBlueprintColor,
  onToggleBlueprintHidden,
  onClearBlueprint,
  onCleanupBlueprint,
  devTargets,
  onSelectDevTarget,
}: HUDProps) {
  const selected = graph.files.find((file) => file.id === selectedId)
  const selectedFolderNode = graph.folders.find(
    (folder) => folder.path === selectedFolder,
  )
  const folderFiles = selectedFolderNode
    ? graph.files.filter(
        (file) =>
          selectedFolderNode.files.includes(file.id) ||
          file.folder === selectedFolderNode.path,
      )
    : []
  const aimed = graph.files.find((file) => file.id === aimedRelation?.flyTo)
  const importers = selected
    ? graph.files.filter((file) => file.imports.includes(selected.id))
    : []
  const mapping = mode === 'map'
  const sessions = (intents ?? [intent]).filter(
    (item) => item.sessionId && isReviewingIntent(item.status),
  )
  const nextAttachSession =
    sessions.find((session) => session.sessionId === nextAttachSessionId) ??
    [...sessions].reverse().find((session) => session.awaitingAttach) ??
    null
  const [walkIntro, setWalkIntro] = useState(false)
  const walkIntroSeen = useRef(false)
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
  const [actionsMenuPosition, setActionsMenuPosition] = useState<CSSProperties>()
  const actionsMenuRef = useRef<HTMLDivElement>(null)
  const [noteEditor, setNoteEditor] = useState<{
    file: string
    kind: BlueprintNoteKind
    name?: string
    title: string
    subtitle: string
    placeholder: string
  } | null>(null)
  const [infoVisible, setInfoVisible] = useState(false)
  const [infoMinimized, setInfoMinimized] = useState(false)
  const infoPanelRef = useRef<HTMLDivElement>(null)
  const canPlace = true
  const overlay = showBranchChanges && branchChanges ? branchChanges : intent
  const previewing = intent.preview || showBranchChanges
  const addedFunctions = overlay.addedFunctions ?? []
  const addedVariables = overlay.addedVariables ?? []
  const addedImports = overlay.addedImports ?? []
  const changedFunctions = overlay.changedFunctions ?? []
  const changedVariables = overlay.changedVariables ?? []
  const selectedAddedFunctions = selected
    ? addedFunctions.filter((item) => item.file === selected.id)
    : []
  const selectedAddedVariables = selected
    ? addedVariables.filter((item) => item.file === selected.id)
    : []
  const selectedAddedImports = selected
    ? addedImports.filter((item) => item.file === selected.id)
    : []
  const selectedChangedFunctions = selected
    ? changedFunctions.filter((item) => item.file === selected.id)
    : []
  const selectedChangedVariables = selected
    ? changedVariables.filter((item) => item.file === selected.id)
    : []
  const selectedClasses = selected
    ? selected.symbols.filter((symbol) => symbol.kind === 'class')
    : []
  const selectedFunctions = selected
    ? selected.symbols.filter((symbol) => symbol.kind === 'function')
    : []
  const selectedVariables = selected
    ? selected.symbols.filter((symbol) => symbol.kind === 'variable')
    : []
  const functionChange = new Map<string, 'add' | 'edit'>([
    ...selectedChangedFunctions.map(
      (item) => [item.name, 'edit'] as const,
    ),
    ...selectedAddedFunctions.map((item) => [item.name, 'add'] as const),
  ])
  const variableChange = new Map<string, 'add' | 'edit'>([
    ...selectedChangedVariables.map(
      (item) => [item.name, 'edit'] as const,
    ),
    ...selectedAddedVariables.map((item) => [item.name, 'add'] as const),
  ])
  const extraAddedFunctions = extraAddedSymbols(
    selectedFunctions,
    selectedAddedFunctions,
  )
  const extraAddedVariables = extraAddedSymbols(
    selectedVariables,
    selectedAddedVariables,
  )
  const selectedBlueprintFunctions = selected
    ? blueprintFunctions.filter((item) => item.file === selected.id)
    : []
  const selectedBlueprintVariables = selected
    ? blueprintVariables.filter((item) => item.file === selected.id)
    : []
  const selectedBlueprintImports = selected
    ? blueprintImports.filter((item) => item.file === selected.id)
    : []
  const intendedImportFrom = new Set(
    selectedBlueprintImports.map((item) => item.from),
  )
  const extraBlueprintImports = selectedBlueprintImports.filter(
    (item) => !selected?.imports.includes(item.from),
  )
  const canEditBlueprint =
    canPlace && Boolean(selected) && !selected?.id.startsWith('draft:')
  const canRenameSelected =
    Boolean(onRenameCreatedFile) &&
    Boolean(selected?.userCreated) &&
    !selected?.id.startsWith('draft:')
  const renameSelectedFile = (nextName: string) => {
    if (!selected || !onRenameCreatedFile) return false
    const previousId = selected.id
    const nextId = onRenameCreatedFile(previousId, nextName)
    if (!nextId) return false
    setNoteEditor((current) =>
      current?.file === previousId ? { ...current, file: nextId } : current,
    )
    return true
  }
  const selectedFileNote = selected
    ? findBlueprintNote(blueprintNotes, selected.id, 'file')
    : ''
  const openFileNote = () => {
    if (!selected || !onSetBlueprintNote) return
    setInstructionsOpen(false)
    setNoteEditor({
      file: selected.id,
      kind: 'file',
      title: `Note · ${selected.name}`,
      subtitle: selected.path,
      placeholder: 'Extra instructions or pseudo code for this file',
    })
  }
  const openSymbolNote = (
    kind: 'function' | 'variable',
    name: string,
  ) => {
    if (!selected || !onSetBlueprintNote) return
    setInstructionsOpen(false)
    setNoteEditor({
      file: selected.id,
      kind,
      name,
      title: `Note · ${name}`,
      subtitle: `${kind} in ${selected.path}`,
      placeholder: `Instructions or pseudo code for ${name}`,
    })
  }
  const canInspectFile = (fileId: string, userCreated = false) =>
    Boolean(onInspectFile) &&
    !fileId.startsWith('draft:') &&
    !(previewing && (intent.deletes ?? []).includes(fileId)) &&
    (!userCreated || (intent.creates ?? []).includes(fileId))

  useEffect(() => {
    if (mode !== 'walk') {
      walkIntroSeen.current = false
      setWalkIntro(false)
      return
    }
    if (locked || naming) {
      walkIntroSeen.current = true
      setWalkIntro(false)
      return
    }
    if (walkIntroSeen.current) {
      setWalkIntro(false)
      return
    }
    const timer = window.setTimeout(() => setWalkIntro(true), 160)
    return () => window.clearTimeout(timer)
  }, [locked, mode, naming])

  useEffect(() => {
    infoPanelRef.current?.scrollTo({ top: 0 })
  }, [selectedId, selectedFolder])

  useEffect(() => {
    if (mode === 'walk') return
    if (selectedId) setInfoVisible(true)
  }, [mode, selectedId, selectedTick])

  useEffect(() => {
    if (inspectTick > 0) {
      setInfoVisible(true)
      setInfoMinimized(false)
    }
  }, [inspectTick])

  useEffect(() => {
    if (selectedFolder) setInfoVisible(true)
  }, [selectedFolder])

  useEffect(() => {
    if (!locked) return
    setInfoVisible(false)
    setInfoMinimized(false)
  }, [locked])

  useEffect(() => {
    if (infoVisible || !importPickActive) return
    onCancelImportPick?.()
  }, [importPickActive, infoVisible, onCancelImportPick])

  const infoOpen = infoVisible && Boolean(selected || selectedFolderNode)

  useEffect(() => {
    if (infoOpen) document.exitPointerLock()
  }, [infoOpen])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'KeyI') return
      if (shouldIgnoreShortcut(event)) return
      event.preventDefault()
      if (infoVisible) {
        setInfoVisible(false)
        setInfoMinimized(false)
        return
      }
      const blockId = aimedFileId ?? selectedId
      if (mode === 'walk') {
        if (!blockId) return
        onInspectBlock?.(blockId)
      }
      setInfoMinimized(false)
      setInfoVisible(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [aimedFileId, infoVisible, mode, onInspectBlock, selectedId])

  useEffect(() => {
    if (!infoVisible || (!selectedId && !selectedFolder)) return
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'ArrowUp' && event.code !== 'ArrowDown') return
      if (shouldIgnoreShortcut(event)) return
      const panel = infoPanelRef.current
      if (!panel || panel.scrollHeight <= panel.clientHeight + 1) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const step = Math.max(40, Math.round(panel.clientHeight * 0.2))
      panel.scrollBy({ top: event.code === 'ArrowDown' ? step : -step })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [infoVisible, selectedId, selectedFolder])

  useEffect(() => {
    if (!instructionsOpen) return
    document.exitPointerLock()
    setActionsMenuOpen(false)
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return
      if (shouldIgnoreShortcut(event)) return
      event.preventDefault()
      event.stopPropagation()
      setInstructionsOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [instructionsOpen])

  useLayoutEffect(() => {
    if (!actionsMenuOpen) return
    const updatePosition = () => {
      const trigger = actionsMenuRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      setActionsMenuPosition({
        right: window.innerWidth - rect.right,
        bottom: window.innerHeight - rect.top + 8,
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [actionsMenuOpen])

  useEffect(() => {
    if (!actionsMenuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return
      if (shouldIgnoreShortcut(event)) return
      event.preventDefault()
      event.stopPropagation()
      setActionsMenuOpen(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Element &&
        (actionsMenuRef.current?.contains(target) ||
          target.closest('.hud-actions-menu-list'))
      ) {
        return
      }
      setActionsMenuOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [actionsMenuOpen])

  const instructionSections = explorerInstructions({
    canPlace,
    hasChangeSet,
    changePathsOnly,
    selectedUserCreated: Boolean(selected?.userCreated),
    infoVisible,
    importedBy,
    showBranchChanges,
    canShowBranchChanges,
  })
  const currentInstructionView: InstructionView = mapping ? 'map' : 'walk'

  return (
    <div className="hud">
      {mode === 'walk' && !locked && walkIntro && !naming && (
        <div className="hud-gate">
          <div className="hud-gate-card">
            <h1>Walk</h1>
            <p>
              Click to look around. Double-click to release the mouse. Press{' '}
              <kbd>M</kbd> to open the map, press <kbd>M</kbd> again to return
              here.
            </p>
            <p>
              <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> walk,{' '}
              <kbd>Shift</kbd> sprint, double-click a file or folder or press{' '}
              <kbd>I</kbd> for info.
            </p>
          </div>
        </div>
      )}

      {mode === 'walk' &&
        namingIsland &&
        onCommitIslandName &&
        onCancelIslandName && (
          <div className="hud-name-gate">
            <NameInput
              placeholder="Folder name"
              fallbackName="New folder"
              onCommit={onCommitIslandName}
              onCancel={onCancelIslandName}
            />
          </div>
        )}

      {mode === 'walk' && locked && (
        <div className="crosshair" data-aim={Boolean(aimed)} />
      )}
      {mode === 'walk' && locked && aimed && (
        <div className="hud-aim">Click to fly to {aimed.name}</div>
      )}

      <div className="hud-top">
        <div className="hud-mode">
          <button
            className="hud-button"
            data-active={mapping}
            type="button"
            onClick={onOpenMap}
          >
            Map
          </button>
          <button
            className="hud-button"
            data-active={!mapping}
            type="button"
            onClick={onWalk}
          >
            Walk
          </button>
        </div>
        {(selected ||
          (devTargets?.enabled &&
            onSelectDevTarget &&
            devTargets.targets.length > 0)) && (
          <div className="hud-top-end">
            {selected && <div className="hud-chip">{selected.path}</div>}
            {devTargets?.enabled &&
              onSelectDevTarget &&
              devTargets.targets.length > 0 && (
                <label className="hud-target-select">
                  <span>Look at</span>
                  <select
                    className="hud-button hud-target-select-control"
                    aria-label="Look at"
                    title="Choose which project the map scans. Only available while developing Inbase."
                    value={devTargets.currentId ?? ''}
                    disabled={updatingModel}
                    onChange={(event) => {
                      const next = event.target.value
                      if (!next || next === devTargets.currentId) return
                      onSelectDevTarget(next)
                    }}
                  >
                    {devTargets.targets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
          </div>
        )}
      </div>

      {(sessions.length > 0 || showBranchChanges) && (
        <div className="hud-left-stack">
          {sessions.length > 1 && (
            <div className="hud-session-tabs" role="tablist" aria-label="LLM sessions">
              {sessions.map((session) => {
                const active =
                  session.sessionId === (focusedSessionId ?? intent.sessionId)
                const attached = session.awaitingAttach === false
                const label = sessionDisplayName(session) || 'Session'
                return (
                  <button
                    className="hud-button hud-session-tab"
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-label={
                      attached ? `${label}, attached` : `${label}, waiting`
                    }
                    data-active={active}
                    data-attached={attached}
                    key={session.sessionId}
                    title={attached ? `${label} · Attached` : `${label} · Waiting`}
                    style={
                      session.colorHex
                        ? ({
                            '--session-color': session.colorHex,
                          } as CSSProperties)
                        : undefined
                    }
                    onClick={() => {
                      if (session.sessionId) onFocusSession?.(session.sessionId)
                      if (session.color) onSelectBlueprintColor?.(session.color)
                    }}
                  >
                    <SessionSwatch colorHex={session.colorHex} />
                  </button>
                )
              })}
            </div>
          )}
          {sessions.length > 0 && (
            <SessionPanel
              intent={intent}
              focused
              naming={naming}
              nextAttachSession={nextAttachSession}
              onFocus={() => {
                if (intent.sessionId) onFocusSession?.(intent.sessionId)
              }}
              onWorkflowAction={onWorkflowAction}
              onNavigateDiff={onNavigateDiff}
            />
          )}
          {showBranchChanges && branchChanges && (
            <BranchChangesPanel changes={branchChanges} />
          )}
        </div>
      )}

      <div className="hud-right-stack">
      {selected && infoVisible && (
        <aside
          className="hud-panel hud-panel-info"
          data-minimized={infoMinimized}
        >
          <PanelChrome
            title={
              canRenameSelected ? (
                <InfoNameField
                  name={selected.name}
                  onRename={renameSelectedFile}
                />
              ) : (
                selected.name
              )
            }
            minimized={infoMinimized}
            onMinimize={() => setInfoMinimized((current) => !current)}
            onClose={() => {
              setInfoVisible(false)
              setInfoMinimized(false)
            }}
          />
          {!infoMinimized && (
            <div ref={infoPanelRef} className="hud-panel-body">
          <p className="path">{selected.path}</p>
          <p>
            {selected.lines} lines · {selected.language}
          </p>
          {(onExplainTarget ||
            canInspectFile(selected.id, selected.userCreated)) && (
            <div className="hud-file-actions">
              {onExplainTarget ? (
                <ExplainButton
                  label={`Explain ${selected.name}`}
                  onClick={() =>
                    onExplainTarget({ kind: 'file', path: selected.id })
                  }
                />
              ) : null}
              {canInspectFile(selected.id, selected.userCreated) && (
                <button
                  className="hud-button hud-inspect"
                  type="button"
                  onClick={() => onInspectFile?.(selected.id)}
                >
                  Inspect file
                </button>
              )}
            </div>
          )}
          {canEditBlueprint && onToggleBlueprintPointer && (
            <PointColorControl
              target={{ kind: 'file', path: selected.id }}
              colorPointers={blueprintColorPointers}
              currentColorId={blueprintColor}
              idleLabel="Point to file"
              pointedLabel="Stop pointing"
              onToggle={(color) =>
                onToggleBlueprintPointer({
                  kind: 'file',
                  path: selected.id,
                  color,
                })
              }
            />
          )}
          {canEditBlueprint && onSetBlueprintNote && (
            <button
              className="hud-button hud-inspect"
              type="button"
              data-has-note={selectedFileNote ? 'true' : 'false'}
              data-open={
                noteEditor?.kind === 'file' && noteEditor.file === selected.id
                  ? 'true'
                  : 'false'
              }
              onClick={openFileNote}
            >
              {selectedFileNote ? 'Edit file note' : 'Add file note'}
            </button>
          )}
          {previewing &&
            (selectedChangedFunctions.length > 0 ||
              selectedAddedFunctions.length > 0 ||
              selectedChangedVariables.length > 0 ||
              selectedAddedVariables.length > 0 ||
              selectedAddedImports.length > 0) && (
              <>
                <div className="hud-section-title hud-section-title-edit">
                  {showBranchChanges ? 'Branch changes' : 'LLM changes'}
                </div>
                <PatchSymbolChanges
                  title="Functions"
                  added={selectedAddedFunctions}
                  changed={selectedChangedFunctions}
                />
                <PatchSymbolChanges
                  title="Vars"
                  added={selectedAddedVariables}
                  changed={selectedChangedVariables}
                />
                <PanelList
                  title="Imports"
                  items={importLabels(selectedAddedImports)}
                  tone="add"
                />
              </>
            )}
          {selectedClasses.length > 0 && (
            <>
              <div className="hud-section-title">Classes</div>
              <ul>
                {selectedClasses.map((symbol) => (
                  <li key={`class-${symbol.name}`}>
                    <span
                      className={
                        symbolChangeClass(functionChange.get(symbol.name)) ??
                        (symbol.intended ? 'hud-intended' : undefined)
                      }
                    >
                      {symbol.name}
                    </span>
                    {onExplainTarget ? (
                      <div className="hud-item-actions">
                        <ExplainButton
                          compact
                          label={`Explain ${symbol.name}`}
                          onClick={() =>
                            onExplainTarget({
                              kind: 'class',
                              path: selected.id,
                              name: symbol.name,
                            })
                          }
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="hud-section-title">Functions</div>
          {selectedFunctions.length === 0 &&
          extraAddedFunctions.length === 0 &&
          selectedBlueprintFunctions.length === 0 ? (
            <p>No functions</p>
          ) : (
            <ul>
              {selectedFunctions.map((symbol) => (
                <BlueprintSymbolRow
                  key={`fn-${symbol.name}`}
                  name={symbol.name}
                  className={
                    symbolChangeClass(functionChange.get(symbol.name)) ??
                    (symbol.intended ? 'hud-intended' : undefined)
                  }
                  hasNote={Boolean(
                    findBlueprintNote(
                      blueprintNotes,
                      selected.id,
                      'function',
                      symbol.name,
                    ),
                  )}
                  noteOpen={
                    noteEditor?.kind === 'function' &&
                    noteEditor.file === selected.id &&
                    noteEditor.name === symbol.name
                  }
                  canEdit={Boolean(canEditBlueprint && onSetBlueprintNote)}
                  canRemove={Boolean(canEditBlueprint && symbol.intended)}
                  pointerTarget={{
                    kind: 'function',
                    path: selected.id,
                    name: symbol.name,
                  }}
                  colorPointers={blueprintColorPointers}
                  currentColorId={blueprintColor}
                  onRemove={() =>
                    onRemoveBlueprintFunction?.(selected.id, symbol.name)
                  }
                  onOpenNote={() => openSymbolNote('function', symbol.name)}
                  onExplain={
                    onExplainTarget
                      ? () =>
                          onExplainTarget({
                            kind: 'function',
                            path: selected.id,
                            name: symbol.name,
                          })
                      : undefined
                  }
                  onTogglePoint={
                    onToggleBlueprintPointer
                      ? (color) =>
                          onToggleBlueprintPointer({
                            kind: 'function',
                            path: selected.id,
                            name: symbol.name,
                            color,
                          })
                      : undefined
                  }
                />
              ))}
              {extraAddedFunctions.map((item) => (
                <BlueprintSymbolRow
                  key={`fn-add-${item.name}`}
                  name={item.name}
                  className="hud-file-add"
                  hasNote={Boolean(
                    findBlueprintNote(
                      blueprintNotes,
                      selected.id,
                      'function',
                      item.name,
                    ),
                  )}
                  noteOpen={
                    noteEditor?.kind === 'function' &&
                    noteEditor.file === selected.id &&
                    noteEditor.name === item.name
                  }
                  canEdit={Boolean(canEditBlueprint && onSetBlueprintNote)}
                  pointerTarget={{
                    kind: 'function',
                    path: selected.id,
                    name: item.name,
                  }}
                  colorPointers={blueprintColorPointers}
                  currentColorId={blueprintColor}
                  onOpenNote={() => openSymbolNote('function', item.name)}
                  onExplain={
                    onExplainTarget
                      ? () =>
                          onExplainTarget({
                            kind: 'function',
                            path: selected.id,
                            name: item.name,
                          })
                      : undefined
                  }
                  onTogglePoint={
                    onToggleBlueprintPointer
                      ? (color) =>
                          onToggleBlueprintPointer({
                            kind: 'function',
                            path: selected.id,
                            name: item.name,
                            color,
                          })
                      : undefined
                  }
                />
              ))}
            </ul>
          )}
          {canEditBlueprint && onAddBlueprintFunction && (
            <AddIntentRow
              placeholder="Function name"
              onAdd={(name) => onAddBlueprintFunction(selected.id, name)}
            />
          )}
          <div className="hud-section-title">Vars</div>
          {selectedVariables.length === 0 &&
          extraAddedVariables.length === 0 &&
          selectedBlueprintVariables.length === 0 ? (
            <p>No vars</p>
          ) : (
            <ul>
              {selectedVariables.map((symbol) => (
                <BlueprintSymbolRow
                  key={`var-${symbol.name}`}
                  name={symbol.name}
                  className={
                    symbolChangeClass(variableChange.get(symbol.name)) ??
                    (symbol.intended ? 'hud-intended' : undefined)
                  }
                  hasNote={Boolean(
                    findBlueprintNote(
                      blueprintNotes,
                      selected.id,
                      'variable',
                      symbol.name,
                    ),
                  )}
                  noteOpen={
                    noteEditor?.kind === 'variable' &&
                    noteEditor.file === selected.id &&
                    noteEditor.name === symbol.name
                  }
                  canEdit={Boolean(canEditBlueprint && onSetBlueprintNote)}
                  canRemove={Boolean(canEditBlueprint && symbol.intended)}
                  pointerTarget={{
                    kind: 'variable',
                    path: selected.id,
                    name: symbol.name,
                  }}
                  colorPointers={blueprintColorPointers}
                  currentColorId={blueprintColor}
                  onRemove={() =>
                    onRemoveBlueprintVariable?.(selected.id, symbol.name)
                  }
                  onOpenNote={() => openSymbolNote('variable', symbol.name)}
                  onExplain={
                    onExplainTarget
                      ? () =>
                          onExplainTarget({
                            kind: 'variable',
                            path: selected.id,
                            name: symbol.name,
                          })
                      : undefined
                  }
                  onTogglePoint={
                    onToggleBlueprintPointer
                      ? (color) =>
                          onToggleBlueprintPointer({
                            kind: 'variable',
                            path: selected.id,
                            name: symbol.name,
                            color,
                          })
                      : undefined
                  }
                />
              ))}
              {extraAddedVariables.map((item) => (
                <BlueprintSymbolRow
                  key={`var-add-${item.name}`}
                  name={item.name}
                  className="hud-file-add"
                  hasNote={Boolean(
                    findBlueprintNote(
                      blueprintNotes,
                      selected.id,
                      'variable',
                      item.name,
                    ),
                  )}
                  noteOpen={
                    noteEditor?.kind === 'variable' &&
                    noteEditor.file === selected.id &&
                    noteEditor.name === item.name
                  }
                  canEdit={Boolean(canEditBlueprint && onSetBlueprintNote)}
                  pointerTarget={{
                    kind: 'variable',
                    path: selected.id,
                    name: item.name,
                  }}
                  colorPointers={blueprintColorPointers}
                  currentColorId={blueprintColor}
                  onOpenNote={() => openSymbolNote('variable', item.name)}
                  onExplain={
                    onExplainTarget
                      ? () =>
                          onExplainTarget({
                            kind: 'variable',
                            path: selected.id,
                            name: item.name,
                          })
                      : undefined
                  }
                  onTogglePoint={
                    onToggleBlueprintPointer
                      ? (color) =>
                          onToggleBlueprintPointer({
                            kind: 'variable',
                            path: selected.id,
                            name: item.name,
                            color,
                          })
                      : undefined
                  }
                />
              ))}
            </ul>
          )}
          {canEditBlueprint && onAddBlueprintVariable && (
            <AddIntentRow
              placeholder="Variable name"
              onAdd={(name) => onAddBlueprintVariable(selected.id, name)}
            />
          )}
          <div className="hud-section-title">
            {importedBy ? 'Imported by' : 'Imports'}
          </div>
          {importedBy ? (
            importers.length === 0 ? (
              <p>Nothing local imports this</p>
            ) : (
              <ul>
                {importers.map((file) => (
                  <li key={file.id} title={file.id}>
                    {file.name}
                  </li>
                ))}
              </ul>
            )
          ) : selected.imports.length === 0 && extraBlueprintImports.length === 0 ? (
            <p>No local imports</p>
          ) : (
            <ul>
              {selected.imports.map((id) => (
                <li key={id}>
                  <span
                    className={
                      intendedImportFrom.has(id) ? 'hud-intended' : undefined
                    }
                    title={id}
                  >
                    {fileBase(id)}
                  </span>
                  {canEditBlueprint && intendedImportFrom.has(id) && (
                    <button
                      className="hud-item-remove"
                      type="button"
                      aria-label={`Remove import ${id}`}
                      onClick={() => {
                        const item = selectedBlueprintImports.find(
                          (entry) => entry.from === id,
                        )
                        if (item) {
                          onRemoveBlueprintImport?.(
                            selected.id,
                            item.name,
                            item.from,
                          )
                        }
                      }}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
              {extraBlueprintImports.map((item) => (
                <li key={`bp-${item.name}-${item.from}`}>
                  <span className="hud-intended" title={item.from}>
                    {importLabel(item)}
                  </span>
                  {canEditBlueprint && (
                    <button
                      className="hud-item-remove"
                      type="button"
                      aria-label={`Remove import ${item.name}`}
                      onClick={() =>
                        onRemoveBlueprintImport?.(
                          selected.id,
                          item.name,
                          item.from,
                        )
                      }
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEditBlueprint && !importedBy && onAddBlueprintImport && (
            <>
              <AddIntentRow
                placeholder="Clock from src/components/Clock.tsx"
                onAdd={(raw) => onAddBlueprintImport(selected.id, raw)}
                pickLabel={mapping ? 'Select a file' : undefined}
                pickActive={importPickActive}
                onTogglePick={mapping ? onToggleImportPick : undefined}
              />
              {importPickActive && (
                <p className="hud-pick-hint">
                  Click a file to import it. Esc to cancel.
                </p>
              )}
            </>
          )}
            </div>
          )}
        </aside>
      )}

      {!selected && selectedFolderNode && infoVisible && (
        <aside
          className="hud-panel hud-panel-info"
          data-minimized={infoMinimized}
        >
          <PanelChrome
            title={selectedFolderNode.name}
            minimized={infoMinimized}
            onMinimize={() => setInfoMinimized((current) => !current)}
            onClose={() => {
              setInfoVisible(false)
              setInfoMinimized(false)
            }}
            onExplain={
              onExplainTarget
                ? () =>
                    onExplainTarget({
                      kind: 'folder',
                      path: selectedFolderNode.path,
                    })
                : undefined
            }
            explainLabel={`Explain ${selectedFolderNode.name}`}
          />
          {!infoMinimized && (
            <div ref={infoPanelRef} className="hud-panel-body">
          <p className="path">
            {selectedFolderNode.path === '.'
              ? graph.targetName
              : selectedFolderNode.path}
          </p>
          <p>
            {folderFiles.length} {folderFiles.length === 1 ? 'file' : 'files'}
          </p>
          <div className="hud-section-title">Files</div>
          {folderFiles.length === 0 ? (
            <p>No files in this folder</p>
          ) : (
            <ul>
              {folderFiles.map((file) => (
                <li key={file.id}>
                  <span>{file.name}</span>
                  {(onExplainTarget ||
                    canInspectFile(file.id, file.userCreated)) && (
                    <div className="hud-item-actions">
                      {onExplainTarget ? (
                        <ExplainButton
                          compact
                          label={`Explain ${file.name}`}
                          onClick={() =>
                            onExplainTarget({ kind: 'file', path: file.id })
                          }
                        />
                      ) : null}
                      {canInspectFile(file.id, file.userCreated) && (
                        <button
                          className="hud-item-inspect"
                          type="button"
                          onClick={() => onInspectFile?.(file.id)}
                        >
                          Inspect
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canPlace && onToggleBlueprintPointer && (
            <PointColorControl
              target={{ kind: 'folder', path: selectedFolderNode.path }}
              colorPointers={blueprintColorPointers}
              currentColorId={blueprintColor}
              idleLabel="Point to folder"
              pointedLabel="Stop pointing"
              disabled={naming || selectedFolderNode.path.startsWith('draft:')}
              onToggle={(color) =>
                onToggleBlueprintPointer({
                  kind: 'folder',
                  path: selectedFolderNode.path,
                  color,
                })
              }
            />
          )}
          {canPlace && mapping && onMapAddFile && onMapAddFolder && (
            <div className="hud-decide hud-map-blueprint">
              <button
                className="hud-button hud-button-approve"
                type="button"
                disabled={naming}
                onClick={() => onMapAddFile(selectedFolderNode.path)}
              >
                Add file
              </button>
              <button
                className="hud-button"
                type="button"
                disabled={naming}
                onClick={() => onMapAddFolder(selectedFolderNode.path)}
              >
                Add folder
              </button>
            </div>
          )}
            </div>
          )}
        </aside>
      )}
      </div>

      {noteEditor && onSetBlueprintNote && (
        <BlueprintNoteModal
          key={`${noteEditor.kind}:${noteEditor.file}:${noteEditor.name ?? ''}`}
          title={noteEditor.title}
          subtitle={noteEditor.subtitle}
          value={findBlueprintNote(
            blueprintNotes,
            noteEditor.file,
            noteEditor.kind,
            noteEditor.name,
          )}
          placeholder={noteEditor.placeholder}
          onChange={(note) =>
            onSetBlueprintNote({
              file: noteEditor.file,
              kind: noteEditor.kind,
              name: noteEditor.name,
              note,
            })
          }
          onClose={() => setNoteEditor(null)}
        />
      )}

      {instructionsOpen && (
        <div
          className="hud-instructions-overlay"
          onClick={() => setInstructionsOpen(false)}
        >
          <div
            className="hud-instructions-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hud-instructions-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="hud-instructions-header">
              <h1 id="hud-instructions-title">Instructions</h1>
              <button
                className="hud-button"
                type="button"
                onClick={() => setInstructionsOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="hud-instructions-sections">
              {instructionSections.map((section) => (
                <section
                  className="hud-instructions-section"
                  data-current={section.id === currentInstructionView}
                  key={section.id}
                  aria-labelledby={`hud-instructions-${section.id}`}
                >
                  <h2 id={`hud-instructions-${section.id}`}>
                    {section.title}
                    {section.id === currentInstructionView && (
                      <span className="hud-instructions-current">Current</span>
                    )}
                  </h2>
                  <InstructionList items={section.items} />
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="hud-bottom">
        <div className="hud-bottom-actions">
          {onSelectBlueprintColor && blueprintOptions.length > 0 && (
            <div
              className="hud-blueprint-select"
              role="radiogroup"
              aria-label="Blueprint"
            >
              {blueprintOptions.map((option) => {
                const selected = (blueprintColor ?? 'global') === option.id
                return (
                  <button
                    key={option.id}
                    className={
                      option.kind === 'global'
                        ? 'hud-button hud-blueprint-option'
                        : 'hud-button hud-blueprint-option hud-blueprint-option-swatch'
                    }
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-active={selected}
                    aria-label={
                      option.kind === 'global'
                        ? 'Global blueprint'
                        : `${option.name} session blueprint`
                    }
                    title={
                      option.kind === 'global'
                        ? 'Place on the global blueprint. All colors stay visible.'
                        : `Place on the ${option.name} blueprint. All colors stay visible.`
                    }
                    style={
                      {
                        '--session-color': option.hex,
                      } as CSSProperties
                    }
                    onClick={() => onSelectBlueprintColor(option.id)}
                  >
                    <SessionSwatch
                      colorHex={option.hex}
                      className="hud-session-swatch hud-blueprint-swatch"
                    />
                    {option.kind === 'global' ? (
                      <span className="hud-blueprint-select-label">Global</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          )}
          {onToggleBlueprintHidden && (
            <button
              className="hud-button"
              type="button"
              data-active={!blueprintHidden}
              aria-label={blueprintHidden ? 'Show blueprint' : 'Hide blueprint'}
              title={
                blueprintHidden
                  ? 'Show this blueprint overlay'
                  : 'Hide this blueprint overlay; other colors stay visible'
              }
              onClick={onToggleBlueprintHidden}
            >
              {blueprintHidden ? 'Show' : 'Hide'}
            </button>
          )}
          {onClearBlueprint && (
            <button
              className="hud-button"
              type="button"
              aria-label="Clear blueprint"
              title="Remove every planned file, folder, and symbol"
              disabled={!blueprintHasContent}
              onClick={onClearBlueprint}
            >
              Clear
            </button>
          )}
          {onCleanupBlueprint && (
            <button
              className="hud-button"
              type="button"
              aria-label="Cleanup blueprint"
              title="Remove blueprint files and folders that already exist"
              disabled={!blueprintCanCleanup}
              onClick={onCleanupBlueprint}
            >
              Cleanup
            </button>
          )}
        </div>
        <div className="hud-icon-row">
          {mapping && hasChangeSet && onToggleChangePathsOnly && (
            <button
              className="hud-button hud-icon-button"
              data-active={changePathsOnly}
              aria-label={
                changePathsOnly
                  ? 'Show all folder paths'
                  : 'Show only changed paths'
              }
              aria-keyshortcuts="C"
              aria-pressed={changePathsOnly}
              type="button"
              onClick={onToggleChangePathsOnly}
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="5" r="2.4" />
                <path d="M12 7.4v4.2" />
                <path d="M12 11.6 6.2 16" />
                <path d="M12 11.6 17.8 16" />
                <circle cx="6.2" cy="18" r="2.1" />
                <circle cx="17.8" cy="18" r="2.1" />
              </svg>
              <span className="hud-tooltip">
                {changePathsOnly
                  ? 'C show all paths'
                  : 'C show only changed paths'}
              </span>
            </button>
          )}
          <button
            className="hud-button hud-icon-button"
            data-active={importedBy}
            aria-label={
              importedBy ? 'Show imports' : 'Show imported by'
            }
            aria-keyshortcuts="K"
            aria-pressed={importedBy}
            type="button"
            onClick={onToggleImportedBy}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="13" y="6" width="8" height="12" rx="1.5" />
              <path d="M3 12h8" />
              <path d="M8 8l4 4-4 4" />
            </svg>
            <span className="hud-tooltip">
              {importedBy ? 'K show imports' : 'K show imported by'}
            </span>
          </button>
          <button
            className="hud-button hud-icon-button"
            data-active={showBranchChanges}
            aria-label={
              llmMakingChanges
                ? 'Show branch changes unavailable while the LLM is making changes'
                : showBranchChanges
                  ? 'Hide branch changes'
                  : 'Show branch changes'
            }
            aria-keyshortcuts="G"
            aria-pressed={showBranchChanges}
            aria-disabled={!canShowBranchChanges}
            type="button"
            onClick={() => {
              if (!canShowBranchChanges) return
              onToggleShowBranchChanges?.()
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="6" cy="5" r="2.4" />
              <circle cx="6" cy="19" r="2.4" />
              <circle cx="18" cy="12" r="2.4" />
              <path d="M6 7.4v9.2" />
              <path d="M6 12h7.2" />
              <path d="M13.2 12c2.2 0 2.2-4.6 4.4-4.6" />
            </svg>
            <span className="hud-tooltip">
              {llmMakingChanges
                ? 'Unavailable while the LLM is making changes'
                : !canShowBranchChanges
                  ? 'No git branch to show'
                  : showBranchChanges
                    ? 'G hide branch changes'
                    : 'G show branch changes'}
            </span>
          </button>
          <div className="hud-actions-menu" ref={actionsMenuRef}>
            <button
              className="hud-button hud-icon-button"
              data-active={actionsMenuOpen}
              type="button"
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={actionsMenuOpen}
              onClick={() => setActionsMenuOpen((open) => !open)}
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 7h16" />
                <path d="M4 12h16" />
                <path d="M4 17h16" />
              </svg>
              <span className="hud-tooltip">More</span>
            </button>
            {actionsMenuOpen &&
              actionsMenuPosition &&
              createPortal(
                <div
                  className="hud-actions-menu-list"
                  role="menu"
                  style={actionsMenuPosition}
                >
                  <button
                    type="button"
                    role="menuitem"
                    aria-haspopup="dialog"
                    aria-expanded={instructionsOpen}
                    onClick={() => {
                      setNoteEditor(null)
                      setActionsMenuOpen(false)
                      setInstructionsOpen((open) => !open)
                    }}
                  >
                    Instructions
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    aria-label="Rescan files and folders"
                    disabled={updatingModel}
                    onClick={() => {
                      setActionsMenuOpen(false)
                      onUpdateModel()
                    }}
                  >
                    {updatingModel ? 'Updating…' : 'Update model'}
                  </button>
                </div>,
                document.body,
              )}
          </div>
        </div>
      </div>
    </div>
  )
}
