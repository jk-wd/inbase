import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BlueprintLoadDialog, BlueprintSaveDialog } from './BlueprintFileDialogs'
import { InfoNameField, NameInput } from './NameInput'
import {
  isReviewingIntent,
  type AgentIntent,
  type AgentIntentStatus,
  type BlueprintNote,
  type BlueprintNoteKind,
  DEFAULT_SESSION_COLOR,
  SESSION_COLORS,
  compareSessionColorOrder,
  sessionColorPageCount,
  sessionColorPageIndex,
  sessionColorsOnPage,
  type BlueprintOption,
  type BlueprintPointer,
  type BlueprintPointerKind,
  type BranchChanges,
  type CodebaseGraph,
  type PatchImportAddition,
  type PatchSymbolAddition,
  type LoadBlueprintInput,
  type RelationMode,
  type SaveBlueprintInput,
  type SavedBlueprintInfo,
  type SavedBlueprintListItem,
  type ViewMode,
  type WorkflowAction,
} from '../types'
import { findBlueprintNote, findBlueprintPointer } from '../userCreated'
import type { BlueprintOverlayLayer } from '../userCreated'
import { folderOfFile, folderParent } from '../layout'
import {
  llmChangeNoteForPath,
  overlayPathChangeKind,
} from '../../scripts/change-notes.mjs'
import { ColorPageIcon, EyeIcon, FileIcon, FolderIcon, MenuIcon, PanelToggleIcon } from './EyeIcon'
import { WalkDrop } from './WalkDrop'
import { beginKeyboardIsolation, shouldIgnoreShortcut } from '../keyboard'
import type { DevTargetsState } from '../devTargets'
import { emptyIntent, fetchSavedBlueprints } from '../agentIntent'

const RELATION_MODE_OPTIONS: { id: RelationMode; label: string }[] = [
  { id: 'targeted', label: 'Targeted' },
  { id: 'all', label: 'All' },
  { id: 'off', label: 'Off' },
  { id: 'changed', label: 'Changed' },
]

function relationModesForView(mapping: boolean, current: RelationMode) {
  return RELATION_MODE_OPTIONS.filter(
    (option) => option.id !== 'changed' || mapping || current === 'changed',
  )
}

function isLastPlanStep(intent: AgentIntent) {
  if (typeof intent.step !== 'number' || !intent.steps?.length) return false
  return intent.step >= intent.steps.length
}

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
  if (!color) return null
  return `/${color}`
}

function isPendingSessionId(sessionId: string | null | undefined) {
  return Boolean(sessionId?.startsWith('pending:'))
}

function waitingColorIntent(colorId: string): AgentIntent {
  const color = SESSION_COLORS.find((item) => item.id === colorId)
  return {
    ...emptyIntent,
    status: 'blueprint',
    awaitingAttach: true,
    creationMode: true,
    sessionId: `pending:${colorId}`,
    color: colorId,
    colorName: color?.name ?? null,
    colorHex: color?.hex ?? null,
  }
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
      {colorCommand ? (
        <>
          Type <kbd>{colorCommand}</kbd> in a chat
          {queued ? ' to skip the queue and connect here' : ' to connect here'}
          .{' '}
        </>
      ) : null}
      Type <kbd>/inbase</kbd> for the next empty slot. A color command with
      no extra text starts from the enabled blueprint. Type{' '}
      <kbd>/connect</kbd> to start from the first enabled blueprint.
    </p>
  )
}

function sessionDisplayName(intent: AgentIntent) {
  return sessionLabel(intent) || sessionColorName(intent)
}

function SessionSwatch({
  colorHex,
  className = 'hud-session-swatch',
  busy = false,
}: {
  colorHex?: string | null
  className?: string
  busy?: boolean
}) {
  return (
    <span
      className={busy ? `${className} hud-session-swatch-busy` : className}
      aria-hidden="true"
      style={
        colorHex
          ? ({ '--session-color': colorHex } as CSSProperties)
          : undefined
      }
    />
  )
}

function ColorPageButton({
  direction,
  onClick,
}: {
  direction: 'prev' | 'next'
  onClick: () => void
}) {
  const label =
    direction === 'next'
      ? 'Show the next session colors'
      : 'Show the previous session colors'
  return (
    <button
      className="hud-button hud-color-page"
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <ColorPageIcon direction={direction} />
    </button>
  )
}

function ColorPager({
  page,
  pageCount,
  onPageChange,
}: {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
}) {
  if (pageCount <= 1) return null
  const direction = page >= pageCount - 1 ? 'prev' : 'next'
  return (
    <ColorPageButton
      direction={direction}
      onClick={() =>
        onPageChange(direction === 'next' ? page + 1 : Math.max(0, page - 1))
      }
    />
  )
}

function pagedBlueprintOptions(options: BlueprintOption[], page: number) {
  const visibleIds = new Set<string>(
    sessionColorsOnPage(page).map((color) => color.id),
  )
  return options.filter((option) => visibleIds.has(option.id))
}

function BlueprintLayerSwatches({
  options,
  selectedId,
  page,
  pageCount,
  onSelect,
  onPageChange,
  locked = false,
}: {
  options: BlueprintOption[]
  selectedId: string | null
  page: number
  pageCount: number
  onSelect: (color: string) => void
  onPageChange: (page: number) => void
  locked?: boolean
}) {
  const visibleOptions = locked
    ? options
    : pagedBlueprintOptions(options, page)
  const showPager = !locked && pageCount > 1
  if (options.length === 0) return null
  return (
    <div
      className="hud-add-modal-layers"
      role="radiogroup"
      aria-label="Layer"
    >
      {visibleOptions.map((option) => {
        const selected = option.id === selectedId
        return (
          <button
            key={option.id}
            className="hud-button hud-blueprint-option hud-blueprint-option-swatch"
            type="button"
            role="radio"
            aria-checked={selected}
            data-active={selected ? 'true' : undefined}
            disabled={locked}
            aria-label={
              locked
                ? `Adding on the ${option.name} layer`
                : `Put on the ${option.name} layer`
            }
            title={
              locked
                ? `This blueprint folder is on the ${option.name} layer`
                : `${option.name} layer`
            }
            style={
              {
                '--session-color': option.hex,
              } as CSSProperties
            }
            onClick={() => {
              if (locked) return
              onSelect(option.id)
            }}
          >
            <SessionSwatch
              colorHex={option.hex}
              className="hud-session-swatch hud-blueprint-swatch"
            />
          </button>
        )
      })}
      {showPager ? (
        <ColorPager
          page={page}
          pageCount={pageCount}
          onPageChange={onPageChange}
        />
      ) : null}
    </div>
  )
}

function defaultAddLayerColor(
  visible: string[],
  current: string | null,
  preferred?: string | null,
) {
  if (preferred) return preferred
  if (visible.length === 1) return visible[0]!
  if (current && visible.includes(current)) return current
  return visible[0] ?? current ?? DEFAULT_SESSION_COLOR.id
}

function AddItemModal({
  kind,
  parentLabel,
  options,
  visibleColors,
  currentColor,
  lockedColor = null,
  initialColor = null,
  onCommit,
  onCancel,
}: {
  kind: 'file' | 'folder'
  parentLabel: string
  options: BlueprintOption[]
  visibleColors: string[]
  currentColor: string | null
  lockedColor?: string | null
  initialColor?: string | null
  onCommit: (name: string, color: string) => boolean
  onCancel: () => void
}) {
  const layerOptions = lockedColor
    ? options.filter((option) => option.id === lockedColor)
    : options
  const preferredColor =
    lockedColor ??
    (initialColor && options.some((option) => option.id === initialColor)
      ? initialColor
      : null)
  const [color, setColor] = useState(() =>
    defaultAddLayerColor(visibleColors, currentColor, preferredColor),
  )
  const [colorPage, setColorPage] = useState(() =>
    sessionColorPageIndex(lockedColor ?? color),
  )
  const colorRef = useRef(color)
  colorRef.current = lockedColor ?? color
  const pageCount = sessionColorPageCount()

  return (
    <div
      className="hud-name-gate"
      onClick={onCancel}
    >
      <div
        className="hud-add-modal"
        role="dialog"
        aria-modal="true"
        aria-label={kind === 'folder' ? 'Add folder' : 'Add file'}
        onClick={(event) => event.stopPropagation()}
      >
        <NameInput
          placeholder={kind === 'folder' ? 'Folder name' : 'File name'}
          fallbackName={kind === 'folder' ? 'New folder' : 'New file'}
          commitOnOutside={false}
          onCommit={(name) => {
            if (!onCommit(name, colorRef.current)) return
          }}
          onCancel={onCancel}
        />
        <p className="hud-add-modal-parent">in {parentLabel}</p>
        <BlueprintLayerSwatches
          options={layerOptions}
          selectedId={lockedColor ?? color}
          page={colorPage}
          pageCount={pageCount}
          locked={Boolean(lockedColor)}
          onSelect={setColor}
          onPageChange={setColorPage}
        />
      </div>
    </div>
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
    colorPointers.find((option) => option.id === (currentColorId ?? DEFAULT_SESSION_COLOR.id)) ??
    colorPointers[0]
  const currentHex = current?.hex ?? DEFAULT_SESSION_COLOR.hex
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
          compact
            ? undefined
            : ({
                '--session-color': currentHex,
              } as CSSProperties)
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
                    {option.name}
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

function LlmChangeNote({
  colorName,
  colorHex,
  note,
}: {
  colorName: string
  colorHex?: string | null
  note: string
}) {
  if (!note) return null
  return (
    <p className="hud-llm-note">
      <span
        className="hud-llm-note-session"
        style={colorHex ? { color: colorHex } : undefined}
      >
        ({colorName})
      </span>
      <span className="hud-llm-note-body">{note}</span>
    </p>
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
  pointerTarget?: {
    kind: BlueprintPointerKind
    path: string
    name: string
  }
  colorPointers?: BlueprintColorOption[]
  currentColorId?: string | null
  onTogglePoint?: (color?: string) => void
}) {
  if (!canEdit) {
    return (
      <li>
        <span className={className}>{name}</span>
      </li>
    )
  }
  return (
    <li>
      <span className={className}>{name}</span>
      <div className="hud-item-actions">
        {onTogglePoint && pointerTarget && (
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
        {canRemove && (
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

function InfoKindTitle({
  kind,
  children,
  onOpen,
  openLabel,
}: {
  kind: 'file' | 'folder'
  children: ReactNode
  onOpen?: () => void
  openLabel?: string
}) {
  const icon = kind === 'folder' ? <FolderIcon /> : <FileIcon />
  if (!onOpen) {
    return (
      <span className="hud-info-kind-title">
        {icon}
        {children}
      </span>
    )
  }
  const label = openLabel ?? (typeof children === 'string' ? children : 'file')
  if (typeof children !== 'string') {
    return (
      <span className="hud-info-kind-title">
        <button
          type="button"
          className="hud-info-open-title"
          onClick={onOpen}
          title={`Open ${label}`}
          aria-label={`Open ${label}`}
        >
          {icon}
        </button>
        {children}
      </span>
    )
  }
  return (
    <button
      type="button"
      className="hud-info-kind-title hud-info-open-title"
      onClick={onOpen}
      title={`Open ${label}`}
      aria-label={`Open ${label}`}
    >
      {icon}
      {children}
    </button>
  )
}

function infoBlueprintStyle(hex: string | null | undefined): CSSProperties | undefined {
  return hex ? ({ '--blueprint-color': hex } as CSSProperties) : undefined
}

function HidePanelsButton({
  side,
  hidden,
  onToggle,
}: {
  side: 'left' | 'right'
  hidden: boolean
  onToggle: () => void
}) {
  const label = hidden
    ? side === 'left'
      ? 'Show left panels'
      : 'Show right panels'
    : side === 'left'
      ? 'Hide left panels'
      : 'Hide right panels'
  return (
    <button
      className="hud-button hud-icon-button hud-hide-panels"
      type="button"
      data-side={side}
      data-active={hidden}
      aria-label={label}
      aria-pressed={hidden}
      title={label}
      onClick={onToggle}
    >
      <PanelToggleIcon side={side} hidden={hidden} />
      <span className="hud-tooltip">{label}</span>
    </button>
  )
}

function PanelControlMark({ kind }: { kind: 'minus' | 'plus' }) {
  return <span className="hud-panel-control-mark" data-kind={kind} aria-hidden="true" />
}

type InfoMenuItem = {
  key: string
  label: string
  disabled?: boolean
  active?: boolean
  onClick: () => void
}

function InfoActionsMenu({ items }: { items: InfoMenuItem[] }) {
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const trigger = triggerRef.current
      const menu = menuRef.current
      if (!trigger || !menu) return
      const rect = trigger.getBoundingClientRect()
      const width = Math.max(rect.width, 188)
      menu.style.maxHeight = 'none'
      const { top, left, maxHeight } = placeAnchoredMenu(
        rect,
        menu.offsetHeight,
        width,
        true,
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
  }, [open, items.length])

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
          menuRef.current?.contains(node) ||
          node.closest('.hud-info-menu-list'))
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

  if (items.length === 0) return null

  return (
    <div ref={triggerRef} className="hud-info-menu">
      <button
        className="hud-button hud-icon-button hud-panel-control"
        type="button"
        aria-label="Info actions"
        aria-haspopup="menu"
        aria-expanded={open}
        data-active={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MenuIcon size={16} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="hud-actions-menu-list hud-info-menu-list"
            role="menu"
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                data-active={item.active ? 'true' : undefined}
                onClick={() => {
                  if (item.disabled) return
                  setOpen(false)
                  item.onClick()
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}

function pointerMenuItem(
  target: { kind: 'file' | 'folder'; path: string },
  colorPointers: BlueprintColorOption[],
  onOpen: () => void,
  disabled = false,
): InfoMenuItem[] {
  if (colorPointers.length === 0) return []
  const pointed = colorPointers.some((option) => optionPointed(option, target))
  return [
    {
      key: 'point',
      label: `Point to ${target.kind}`,
      active: pointed,
      disabled,
      onClick: onOpen,
    },
  ]
}

function BlueprintPointModal({
  title,
  subtitle,
  target,
  colorPointers,
  onToggle,
  onClose,
}: {
  title: string
  subtitle: string
  target: { kind: BlueprintPointerKind; path: string; name?: string }
  colorPointers: BlueprintColorOption[]
  onToggle: (color?: string) => void
  onClose: () => void
}) {
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

  return (
    <div className="hud-note-overlay" onClick={onClose}>
      <div
        className="hud-blueprint-file-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hud-point-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="hud-note-header">
          <div className="hud-note-heading">
            <h1 id="hud-point-picker-title">{title}</h1>
            <p className="hud-note-subtitle">{subtitle}</p>
          </div>
          <button className="hud-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <ul className="hud-point-picker-list">
          {colorPointers.map((option) => {
            const pointed = optionPointed(option, target)
            return (
              <li key={option.id}>
                <button
                  className="hud-button hud-point-picker-item"
                  type="button"
                  data-pointed={pointed ? 'true' : 'false'}
                  aria-pressed={pointed}
                  style={
                    {
                      '--session-color': option.hex,
                    } as CSSProperties
                  }
                  onClick={() => onToggle(option.id)}
                >
                  <EyeIcon size={15} />
                  <span>{option.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function BlueprintColorModal({
  title,
  subtitle,
  options,
  currentColor,
  onSelect,
  onClose,
}: {
  title: string
  subtitle: string
  options: BlueprintOption[]
  currentColor?: string | null
  onSelect: (color: string) => void
  onClose: () => void
}) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [colorPage, setColorPage] = useState(() =>
    sessionColorPageIndex(currentColor),
  )

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

  return (
    <div className="hud-note-overlay" onClick={onClose}>
      <div
        className="hud-blueprint-file-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hud-color-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="hud-note-header">
          <div className="hud-note-heading">
            <h1 id="hud-color-picker-title">{title}</h1>
            <p className="hud-note-subtitle">{subtitle}</p>
          </div>
          <button className="hud-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <BlueprintLayerSwatches
          options={options}
          selectedId={currentColor ?? null}
          page={colorPage}
          pageCount={sessionColorPageCount()}
          onSelect={(color) => {
            if (color !== currentColor) onSelect(color)
            onClose()
          }}
          onPageChange={setColorPage}
        />
      </div>
    </div>
  )
}

function PanelChrome({
  title,
  subtitle,
  badge,
  menu,
  minimized = false,
  onMinimize,
  onClose,
}: {
  title: ReactNode
  subtitle?: ReactNode
  badge?: ReactNode
  menu?: ReactNode
  minimized?: boolean
  onMinimize?: () => void
  onClose?: () => void
}) {
  return (
    <div className="hud-panel-chrome">
      <div className="hud-panel-chrome-top">
        <div className="hud-panel-chrome-title">
          {title}
        </div>
        <div className="hud-panel-controls">
          {badge}
          {menu}
          {onMinimize && (
            <button
              className="hud-button hud-icon-button hud-panel-control"
              type="button"
              aria-label={minimized ? 'Restore' : 'Minimize'}
              onClick={onMinimize}
            >
              <PanelControlMark kind={minimized ? 'plus' : 'minus'} />
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
      {subtitle ? (
        <div className="hud-panel-chrome-subtitle">{subtitle}</div>
      ) : null}
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
              The next <kbd>/inbase</kbd> chat connects to {nextAttachLabel}{' '}
              first. This session stays in the queue.
            </p>
            <ColorConnectHint colorCommand={colorCommand} queued />
          </>
        ) : awaitingAttach ? (
          <>
            <p>
              Open a chat with <kbd>/inbase</kbd> for the next empty slot, or
              a color command to connect here.
            </p>
            <ColorConnectHint colorCommand={colorCommand} />
          </>
        ) : (
          <p>This window is attached. Starting from the chat…</p>
        )}
      </section>
    </div>
  )
}

function sessionLiveStatus(intent: AgentIntent) {
  const ack = intent.lastAck
  const kind = ack?.kind
  const detail = ack?.detail?.trim() || ''
  const browsingHistory = !intent.isActiveDiff && Boolean(intent.diffId)

  if (intent.status === 'finished' || kind === 'finished') {
    return { text: 'Finished', busy: false }
  }
  if (kind === 'stopped' || intent.status === 'rejected') {
    return { text: 'Stopped', busy: false }
  }
  if (kind === 'timeout') {
    return { text: 'Stopped', busy: false }
  }
  if (intent.awaitingAttach) {
    return { text: 'Waiting for a chat', busy: false }
  }
  if (intent.pendingExplain) {
    return { text: 'Type /explainit in chat', busy: false }
  }
  if (intent.explainActive || kind === 'explain') {
    return { text: 'Explanation is on the map — /explainit for a follow-up', busy: false }
  }
  if (browsingHistory) {
    return {
      text: intent.working
        ? 'Viewing this step · LLM is still working'
        : 'Reviewing this step',
      busy: intent.working,
    }
  }
  if (
    intent.status === 'approved' ||
    intent.status === 'extended' ||
    intent.status === 'extend'
  ) {
    return { text: 'Reviewing this step', busy: false }
  }
  if (intent.status === 'pending') {
    if (isLastPlanStep(intent)) {
      return { text: 'Click Done to keep the changes', busy: false }
    }
    return { text: 'LLM is continuing', busy: true }
  }
  if (kind === 'execute' && intent.status === 'working') {
    return { text: `LLM received ${detail}`, busy: true }
  }
  if (kind === 'invoke' && intent.status === 'working') {
    return { text: 'LLM is starting…', busy: true }
  }
  if (intent.status === 'working') {
    return { text: 'LLM is working', busy: true }
  }
  if (intent.status === 'replanning') {
    return { text: 'LLM is revising the plan', busy: true }
  }
  if (intent.status === 'preparing') {
    return { text: 'LLM is planning steps', busy: true }
  }
  if (kind === 'plan' || intent.status === 'planned') {
    return { text: 'LLM is starting…', busy: true }
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

function planStepsInvoked(intent: AgentIntent) {
  return (
    intent.steps.length > 0 ||
    (intent.activeSteps?.length ?? 0) > 0 ||
    intent.lastAck?.kind === 'invoke' ||
    intent.lastAck?.kind === 'execute'
  )
}

function LiveStatus({
  intent,
}: {
  intent: AgentIntent
}) {
  const status = sessionLiveStatus(intent)
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
      <span>{status.text}</span>
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
    options?: { step?: number },
  ) => void | boolean | AgentIntent | Promise<void | boolean | AgentIntent>
  onNavigateDiff: (sessionId: string, diffId: string | null) => void
}

function latestDiffForStep(chain: AgentIntent['chain'], stepIndex: number) {
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    if (Number(chain[index].step) === stepIndex) return chain[index]
  }
  return chain[stepIndex - 1] ?? null
}

function planStepOutline(
  step: { index: number; id?: string },
  _siblings?: AgentIntent['steps'],
) {
  return step.id || String(step.index)
}

function planStepOutlineForIntent(
  intent: AgentIntent,
  stepIndex: number | null | undefined,
) {
  if (typeof stepIndex !== 'number' || !intent.steps?.length) return null
  const step = intent.steps.find((entry) => entry.index === stepIndex)
  if (!step) return String(stepIndex)
  return planStepOutline(step, intent.steps)
}

function planElapsedMs(
  startedAt: string | null | undefined,
  stoppedAt: string | null | undefined,
  now = Date.now(),
) {
  if (!startedAt) return 0
  const started = Date.parse(startedAt)
  if (!Number.isFinite(started)) return 0
  const end = stoppedAt ? Date.parse(stoppedAt) : now
  const until = Number.isFinite(end) ? end : now
  return Math.max(0, until - started)
}

function formatPlanElapsed(ms: number) {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function PlanTimer({
  startedAt,
  stoppedAt,
}: {
  startedAt: string | null | undefined
  stoppedAt: string | null | undefined
}) {
  const running = Boolean(startedAt) && !stoppedAt
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running) return
    const tick = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(tick)
  }, [running, startedAt])

  const elapsed = planElapsedMs(startedAt, stoppedAt, running ? now : undefined)
  const label = formatPlanElapsed(elapsed)

  return (
    <p
      className="hud-plan-timer"
      role="timer"
      data-running={running}
      aria-label={running ? `Plan timer ${label}` : `Plan time ${label}`}
    >
      {label}
    </p>
  )
}

function PlanStepList({
  steps,
  intent,
  proposalStep,
  processingSteps,
  acceptedSteps,
  canAcceptProposal,
  onNavigateDiff,
}: {
  steps: AgentIntent['steps']
  intent: AgentIntent
  proposalStep: number | null
  processingSteps: Set<number>
  acceptedSteps: Set<number>
  canAcceptProposal: boolean
  onNavigateDiff: (sessionId: string, diffId: string | null) => void
}) {
  const sessionId = intent.sessionId
  if (!sessionId || steps.length === 0) return null
  return (
    <ol className="hud-steps">
      {steps.map((step) => {
        const proposed = proposalStep === step.index
        const processing = processingSteps.has(step.index)
        const accepted = acceptedSteps.has(step.index) && !proposed
        const stepDiff = latestDiffForStep(intent.chain, step.index)
        const canResumeLive = processing && !intent.isActiveDiff && !stepDiff
        const canOpenDiff = Boolean(stepDiff) || canResumeLive
        const viewing = Boolean(stepDiff) && intent.step === step.index
        const lastStepDone =
          canAcceptProposal && proposed && step.index === intent.steps.at(-1)?.index
        const stepDone = accepted || lastStepDone
        const outline = planStepOutline(step)
        const stepBody = (
          <>
            <span className="hud-step-index">{outline}.</span>
            <span className="hud-step-main">
              <span className="hud-step-title">{step.title}</span>
            </span>
          </>
        )
        return (
          <li
            key={step.id ?? step.index}
            data-done={stepDone}
            data-active={processing || proposed || viewing}
          >
            {canOpenDiff ? (
              <button
                className="hud-step-link hud-step-row"
                type="button"
                aria-current={viewing ? 'step' : undefined}
                aria-label={
                  canResumeLive
                    ? `Show live map for step ${outline}`
                    : `Show diff for step ${outline}`
                }
                title={
                  canResumeLive
                    ? 'Show the live map'
                    : "Show this step's diff"
                }
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onNavigateDiff(sessionId, stepDiff ? stepDiff.id : null)
                }}
              >
                {stepBody}
              </button>
            ) : (
              <div className="hud-step-row">{stepBody}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function SessionPanel({
  intent,
  focused,
  nextAttachSession = null,
  onFocus,
  onWorkflowAction,
  onNavigateDiff,
}: SessionPanelProps) {
  const [minimized, setMinimized] = useState(false)
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
  const chainIndex = intent.chainIndex ?? 0
  const previousDiff = intent.chain[chainIndex - 1]
  const nextDiff = intent.chain[chainIndex + 1]
  const freezeLatestWhileLive =
    intent.isActiveDiff && Boolean(intent.working) && intent.chain.length > 0
  const previousTarget = freezeLatestWhileLive
    ? intent.chain.at(-1)
    : previousDiff
  const resumeLiveNext =
    !intent.isActiveDiff && Boolean(intent.working) && !nextDiff
  const liveStep = intent.liveStep ?? (intent.working ? intent.step : null)
  const currentOutline = planStepOutlineForIntent(intent, intent.step)
  const activeOutlines = (intent.activeSteps?.length
    ? intent.activeSteps
    : intent.step
      ? [intent.step]
      : []
  )
    .map((index) => planStepOutlineForIntent(intent, index))
    .filter(Boolean)
  const lastOutline = intent.steps.length
    ? planStepOutline(intent.steps.at(-1)!)
    : null
  const activeLabel = activeOutlines.join(', ')
  const stepId = activeLabel || currentOutline
  const stepLabel =
    stepId && lastOutline && lastOutline !== stepId && activeOutlines.length <= 1
      ? `Step ${stepId} of ${lastOutline}`
      : stepId
        ? activeOutlines.length > 1
          ? `Steps ${stepId}`
          : `Step ${stepId}`
        : intent.step && intent.steps?.length > 0
          ? `Step ${intent.step} of ${intent.steps.length}`
          : 'Patch'
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
  const processingSteps = new Set(
    (working || intent.working) && typeof liveStep === 'number'
      ? intent.activeSteps?.length
        ? intent.activeSteps
        : [liveStep]
      : [],
  )
  const llmDisconnected =
    Boolean(intent.llmIdle) && intent.awaitingAttach === false
  const canAcceptProposal =
    proposalStep !== null &&
    !llmDisconnected &&
    proposalStep >= (intent.steps?.length ?? 0)
  const panelDone =
    intent.status === 'finished' ||
    intent.status === 'approved' ||
    acceptedSteps.size > 0 ||
    canAcceptProposal
  const llmRunning = sessionLiveStatus(intent).busy
  const closeLabel = llmRunning ? 'Cancel' : 'Done'

  if (!sessionId || !isReviewingIntent(intent.status)) return null

  const handshakeSetup =
    Boolean(intent.awaitingAttach) &&
    (askingBlueprint || sendingBlueprint || preparing)
  const llmConnected = intent.awaitingAttach === false
  const showConnectedProgress =
    llmConnected && !llmDisconnected && (askingBlueprint || sendingBlueprint || preparing)
  const showPlaceHint =
    canPlace && !intent.working && !askingBlueprint && !sendingBlueprint
  const queuedBehind =
    intent.awaitingAttach &&
    nextAttachSession &&
    nextAttachSession.sessionId !== sessionId
      ? sessionDisplayName(nextAttachSession) || 'an earlier session'
      : null

  const act = (
    action: WorkflowAction,
    options?: { step?: number },
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
      style={
        intent.colorHex
          ? ({ '--session-color': intent.colorHex } as CSSProperties)
          : undefined
      }
      onPointerDown={(event) => {
        const target = event.target
        if (
          target instanceof Element &&
          target.closest('button, textarea, input, a, label')
        ) {
          return
        }
        onFocus()
      }}
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
              {!working && !planStepsInvoked(intent) && (
                <LiveStatus intent={intent} />
              )}
            </>
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
                  The next <kbd>/inbase</kbd> chat connects to {queuedBehind}{' '}
                  first. This session stays in the queue.
                </p>
                <ColorConnectHint
                  colorCommand={sessionSlashCommand(intent)}
                  queued
                />
              </div>
            ) : (
              <div className="hud-mode-hint">
                <p>
                  No LLM is attached. Type <kbd>/inbase</kbd>,{' '}
                  <kbd>/connect</kbd>, or a color command to connect.
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
              </div>
            </>
          ) : handshakeSetup ? null : intent.status === 'finished' ? (
            <p>All plan steps were applied.</p>
          ) : (showConnectedProgress || preparing) && intent.steps.length === 0 ? null : (
            <p className="hud-step-label">
              {stepLabel}
            </p>
          )}
          {!askingBlueprint && !sendingBlueprint && (
            <>
              {intent.steps.length > 0 && (
                <PlanTimer
                  startedAt={intent.planTimerStartedAt}
                  stoppedAt={intent.planTimerStoppedAt}
                />
              )}
              <PlanStepList
                steps={intent.steps}
                intent={intent}
                proposalStep={proposalStep}
                processingSteps={processingSteps}
                acceptedSteps={acceptedSteps}
                canAcceptProposal={canAcceptProposal}
                onNavigateDiff={onNavigateDiff}
              />
              {intent.chain.length > 0 && (
                <div className="hud-chain">
                  <button
                    className="hud-button"
                    type="button"
                    disabled={!previousTarget}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      if (previousTarget) onNavigateDiff(sessionId, previousTarget.id)
                    }}
                  >
                    Previous
                  </button>
                  <span>
                    Diff {chainIndex + 1} of {intent.chain.length}
                    {intent.isActiveDiff && intent.working ? ' · live' : ''}
                  </span>
                  <button
                    className="hud-button"
                    type="button"
                    disabled={!nextDiff && !resumeLiveNext}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      if (nextDiff) onNavigateDiff(sessionId, nextDiff.id)
                      else if (resumeLiveNext) onNavigateDiff(sessionId, null)
                    }}
                  >
                    Next
                  </button>
                </div>
              )}
              {(planReady || (pending && !llmDisconnected)) && showPlaceHint && (
                <div className="hud-session-actions">
                  <p className="hud-place-hint">
                    Want a deeper explanation? Type /explainit in the chat.
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}
      {intent.awaitingAttach === false && (
        <div className="hud-session-actions hud-session-close">
          <div className="hud-decide">
            <button
              className="hud-button hud-button-approve"
              type="button"
              aria-label={
                llmRunning
                  ? 'Cancel — drop this LLM connection and free this color'
                  : 'Done — keep changes and free this color'
              }
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                act('done')
              }}
            >
              {closeLabel}
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}

function BranchChangesPanel({
  changes,
  hideChanges,
  onBaseChange,
  onToggleHideChanges,
}: {
  changes: BranchChanges
  hideChanges: boolean
  onBaseChange?: (next: string | null) => void
  onToggleHideChanges?: () => void
}) {
  const selectedBase = changes.current ? '' : (changes.base ?? '')
  const subtitle = changes.current
    ? changes.branch
      ? `${changes.branch} vs last commit`
      : 'vs last commit'
    : changes.branch && changes.base
      ? `${changes.branch} vs ${changes.base}`
      : changes.base
  const emptyMessage = changes.current
    ? 'No uncommitted file changes.'
    : 'No file changes against this branch.'
  const hasContent =
    changes.files.length > 0 ||
    (changes.createFolders ?? []).length > 0 ||
    changes.creates.length > 0 ||
    changes.deletes.length > 0 ||
    (changes.addedFunctions ?? []).length > 0 ||
    (changes.addedVariables ?? []).length > 0 ||
    (changes.addedImports ?? []).length > 0 ||
    (changes.changedFunctions ?? []).length > 0 ||
    (changes.changedVariables ?? []).length > 0 ||
    (changes.imports ?? []).length > 0

  return (
    <>
      <p className="hud-branch-menu-title">Branch changes</p>
      <label className="hud-branch-base">
        <span>Compare against</span>
        <select
          className="hud-button hud-target-select-control hud-branch-base-select"
          aria-label="Compare against"
          value={selectedBase}
          onChange={(event) => {
            const next = event.target.value
            onBaseChange?.(next || null)
          }}
        >
          <option value="">Last commit</option>
          {changes.branches.some((item) => !item.remote) && (
            <optgroup label="Local">
              {changes.branches
                .filter((item) => !item.remote)
                .map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
            </optgroup>
          )}
          {changes.branches.some((item) => item.remote) && (
            <optgroup label="Remote">
              {changes.branches
                .filter((item) => item.remote)
                .map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
            </optgroup>
          )}
        </select>
      </label>
      {subtitle && <p className="hud-feature">{subtitle}</p>}
      {!hasContent && !hideChanges && <p>{emptyMessage}</p>}
      <button
        className="hud-button hud-branch-hide"
        type="button"
        aria-pressed={hideChanges}
        data-active={hideChanges}
        onClick={() => onToggleHideChanges?.()}
      >
        Hide changes
      </button>
    </>
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
  canToggleImportedBy,
  relationMode,
  showBranchChanges,
  canShowBranchChanges,
  showHiddenFiles,
  leftPanelsHidden,
  rightPanelsHidden,
}: {
  canPlace: boolean
  hasChangeSet: boolean
  changePathsOnly: boolean
  selectedUserCreated: boolean
  infoVisible: boolean
  importedBy: boolean
  canToggleImportedBy: boolean
  relationMode: RelationMode
  showBranchChanges: boolean
  canShowBranchChanges: boolean
  showHiddenFiles: boolean
  leftPanelsHidden: boolean
  rightPanelsHidden: boolean
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
  const imported: ExplorerInstruction[] = canToggleImportedBy
    ? [
        {
          id: 'imported',
          keys: ['K'],
          label: importedBy ? 'Show imports' : 'Show imported by',
        },
      ]
    : []
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
  const hidden: ExplorerInstruction[] = [
    {
      id: 'hidden-files',
      keys: ['H'],
      label: showHiddenFiles ? 'Hide hidden files' : 'Show hidden files',
    },
  ]
  const panels: ExplorerInstruction[] = [
    {
      id: 'hide-left-panels',
      keys: ['['],
      label: leftPanelsHidden ? 'Show left panels' : 'Hide left panels',
    },
    {
      id: 'hide-right-panels',
      keys: [']'],
      label: rightPanelsHidden ? 'Show right panels' : 'Hide right panels',
    },
  ]
  return [
    {
      id: 'walk',
      title: 'Walk',
      items: [
        { id: 'wasd', keys: ['W', 'A', 'S', 'D'], label: 'Walk' },
        { id: 'mouse-look', keys: ['Mouse'], label: 'Look around' },
        { id: 'shift', keys: ['Shift'], label: 'Sprint' },
        { id: 'jump', keys: ['Space'], label: 'Jump to the crosshair' },
        ...(canPlace
          ? [
              {
                id: 'point-to',
                keys: ['Point to'],
                label: 'Keep a file, folder, function, or variable in mind',
              },
            ]
          : []),
        ...backspace,
        ...info,
        ...imported,
        {
          id: 'show-relations',
          keys: ['R'],
          label: `Relations: ${
            RELATION_MODE_OPTIONS.find((option) => option.id === relationMode)
              ?.label ?? 'Off'
          }`,
        },
        ...branch,
        ...hidden,
        ...panels,
        {
          id: 'update-model',
          keys: ['More', 'Update model'],
          label: 'Rescan files and folders',
        },
        {
          id: 'cursor-chat',
          keys: ['Chat'],
          label:
            '/inbase connects to the next empty session, /connect for the first enabled blueprint, or a color command for that slot; Done in the session window, /explainit; one chat per color',
        },
        {
          id: 'blueprint-select',
          keys: ['Blueprint colors'],
          label:
            'The color above the session window is the active blueprint',
        },
        {
          id: 'blueprint-toggle',
          keys: ['Hide'],
          label: 'Hide or show the active blueprint overlay',
        },
        {
          id: 'blueprint-opacity',
          keys: ['Opacity'],
          label: 'How strong every blueprint overlay is',
        },
        {
          id: 'blueprint-clear',
          keys: ['Clear'],
          label: 'Remove planned files, folders, and symbols on the active color',
        },
        {
          id: 'blueprint-cleanup',
          keys: ['Cleanup'],
          label: 'Drop existing files and folders on the active color',
        },
        {
          id: 'blueprint-save',
          keys: ['More', 'Save blueprint'],
          label: 'Save the current blueprint into the project blueprints folder',
        },
        {
          id: 'blueprint-save-as',
          keys: ['More', 'Save blueprint as'],
          label: 'Save the current blueprint to another folder',
        },
        {
          id: 'blueprint-load',
          keys: ['More', 'Load blueprint'],
          label: 'Load a saved blueprint onto the map',
        },
        { id: 'toggle-map', keys: ['M', 'Esc'], label: 'Back to map' },
        {
          id: 'release',
          keys: ['Double-click'],
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
                id: 'right-click-file',
                keys: ['Right-click'],
                label: 'A file to open, explain, or change blueprint color',
              },
              {
                id: 'add-file-folder',
                keys: ['Right-click'],
                label: 'Create a file or folder, point to a folder, or change a folder color',
              },
            ]
          : []),
        {
          id: 'walk-drop',
          keys: [],
          label: 'Drag the person onto the map to walk there',
        },
        {
          id: 'option-click-walk',
          keys: ['Option', 'Click'],
          label: 'A place on the map to walk',
        },
        {
          id: 'gold-pin',
          keys: [],
          label: 'Gold pin is your walk position',
        },
        {
          id: 'show-relations',
          keys: ['R'],
          label: `Relations: ${
            RELATION_MODE_OPTIONS.find((option) => option.id === relationMode)
              ?.label ?? 'Off'
          }`,
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
        ...imported,
        ...branch,
        ...hidden,
        ...panels,
        {
          id: 'update-model',
          keys: ['More', 'Update model'],
          label: 'Rescan files and folders',
        },
        {
          id: 'cursor-chat',
          keys: ['Chat'],
          label:
            '/inbase connects to the next empty session, /connect for the first enabled blueprint, or a color command for that slot; Done in the session window, /explainit; one chat per color',
        },
        {
          id: 'blueprint-select',
          keys: ['Blueprint colors'],
          label:
            'The color above the session window is the active blueprint',
        },
        {
          id: 'blueprint-toggle',
          keys: ['Hide'],
          label: 'Hide or show the active blueprint overlay',
        },
        {
          id: 'blueprint-opacity',
          keys: ['Opacity'],
          label: 'How strong every blueprint overlay is',
        },
        {
          id: 'blueprint-clear',
          keys: ['Clear'],
          label: 'Remove planned files, folders, and symbols on the active color',
        },
        {
          id: 'blueprint-cleanup',
          keys: ['Cleanup'],
          label: 'Drop existing files and folders on the active color',
        },
        {
          id: 'blueprint-save',
          keys: ['More', 'Save blueprint'],
          label: 'Save the current blueprint into the project blueprints folder',
        },
        {
          id: 'blueprint-save-as',
          keys: ['More', 'Save blueprint as'],
          label: 'Save the current blueprint to another folder',
        },
        {
          id: 'blueprint-load',
          keys: ['More', 'Load blueprint'],
          label: 'Load a saved blueprint onto the map',
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
  fileNoteTick?: number
  folderNoteTick?: number
  fileColorTick?: number
  folderColorTick?: number
  selectedFolder?: string | null
  selectedFolderLayer?: string | null
  overlayLayers?: BlueprintOverlayLayer[]
  canDeleteSelected?: boolean
  onSelectFolder?: (folderPath: string | null, layer?: string | null) => void
  intent: AgentIntent
  intents?: AgentIntent[]
  focusedSessionId?: string | null
  nextAttachSessionId?: string | null
  onFocusSession?: (sessionId: string) => void
  onWorkflowAction: (
    sessionId: string,
    action: WorkflowAction,
    options?: { step?: number },
  ) => void | boolean | AgentIntent | Promise<void | boolean | AgentIntent>
  onNavigateDiff: (sessionId: string, diffId: string | null) => void
  onOpenMap: () => void
  onWalk: () => void
  walkDrop?: { x: number; y: number } | null
  onWalkDropStart?: (x: number, y: number) => void
  onWalkDropMove?: (x: number, y: number) => void
  onWalkDropEnd?: () => void
  showBranchChanges?: boolean
  wantBranchChanges?: boolean
  hideChanges?: boolean
  branchChanges?: BranchChanges
  canShowBranchChanges?: boolean
  llmMakingChanges?: boolean
  onToggleShowBranchChanges?: () => void
  onToggleHideChanges?: () => void
  onBranchChangesBaseChange?: (base: string | null) => void
  showHiddenFiles?: boolean
  onToggleShowHiddenFiles?: () => void
  onUpdateModel: () => void
  updatingModel?: boolean
  importedBy: boolean
  onToggleImportedBy: () => void
  relationMode?: RelationMode
  onRelationModeChange?: (mode: RelationMode) => void
  changePathsOnly?: boolean
  hasChangeSet?: boolean
  onToggleChangePathsOnly?: () => void
  naming?: boolean
  addingKind?: 'file' | 'folder' | null
  addingParent?: string | null
  addingLockedColor?: string | null
  addingInitialColor?: string | null
  onCommitAdd?: (name: string, color: string) => boolean
  onCancelAdd?: () => void
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
  onChangeCreatedColor?: (next: {
    kind: 'file' | 'folder'
    path: string
    color: string
  }) => void
  onMapAddFile?: (folderPath: string, color?: string) => void
  onMapAddFolder?: (folderPath: string, color?: string) => void
  onRenameCreatedFile?: (fileId: string, name: string) => string | null
  onRenameCreatedFolder?: (folderPath: string, name: string) => string | null
  onInspectFile?: (fileId: string) => void
  onInspectBlock?: (fileId: string) => void
  blueprintOpacity?: number
  onBlueprintOpacityChange?: (opacity: number) => void
  blueprintHasContent?: boolean
  blueprintCanCleanup?: boolean
  blueprintColor?: string | null
  blueprintColors?: string[]
  blueprintOptions?: BlueprintOption[]
  blueprintColorPointers?: BlueprintColorOption[]
  onSelectBlueprintColor?: (color: string) => void
  onToggleBlueprintHidden?: () => void
  onClearBlueprint?: () => void
  onCleanupBlueprint?: () => void
  savedBlueprint?: SavedBlueprintInfo | null
  onSaveBlueprint?: (input: SaveBlueprintInput) => Promise<void>
  onLoadBlueprint?: (input: LoadBlueprintInput) => Promise<void>
  devTargets?: DevTargetsState
  onSelectDevTarget?: (id: string) => void
  explainMode?: boolean
}

export function HUD({
  graph,
  mode,
  locked,
  selectedId,
  selectedTick = 0,
  inspectTick = 0,
  fileNoteTick = 0,
  folderNoteTick = 0,
  fileColorTick = 0,
  folderColorTick = 0,
  selectedFolder = null,
  selectedFolderLayer = null,
  overlayLayers = [],
  canDeleteSelected = false,
  onSelectFolder,
  intent,
  intents,
  focusedSessionId: _focusedSessionId = null,
  nextAttachSessionId = null,
  onFocusSession,
  onWorkflowAction,
  onNavigateDiff,
  onOpenMap,
  onWalk,
  walkDrop = null,
  onWalkDropStart,
  onWalkDropMove,
  onWalkDropEnd,
  showBranchChanges = false,
  wantBranchChanges = false,
  hideChanges = false,
  branchChanges,
  canShowBranchChanges = false,
  llmMakingChanges = false,
  onToggleShowBranchChanges,
  onToggleHideChanges,
  onBranchChangesBaseChange,
  showHiddenFiles = false,
  onToggleShowHiddenFiles,
  onUpdateModel,
  updatingModel = false,
  importedBy,
  onToggleImportedBy,
  relationMode = 'targeted',
  onRelationModeChange,
  changePathsOnly = false,
  hasChangeSet = false,
  onToggleChangePathsOnly,
  naming = false,
  addingKind = null,
  addingParent = null,
  addingLockedColor = null,
  addingInitialColor = null,
  onCommitAdd,
  onCancelAdd,
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
  onChangeCreatedColor,
  onMapAddFile,
  onMapAddFolder,
  onRenameCreatedFile,
  onRenameCreatedFolder,
  onInspectFile,
  onInspectBlock,
  blueprintOpacity = 0.55,
  onBlueprintOpacityChange,
  blueprintHasContent = false,
  blueprintCanCleanup = false,
  blueprintColor = null,
  blueprintColors = [],
  blueprintOptions = [],
  blueprintColorPointers = [],
  onSelectBlueprintColor,
  onToggleBlueprintHidden,
  onClearBlueprint,
  onCleanupBlueprint,
  savedBlueprint = null,
  onSaveBlueprint,
  onLoadBlueprint,
  devTargets,
  onSelectDevTarget,
  explainMode = false,
}: HUDProps) {
  const selected = graph.files.find((file) => file.id === selectedId)
  const selectedFolderNode = graph.folders.find(
    (folder) => folder.path === selectedFolder,
  )
  const selectedBlueprintLayer = selectedFolderLayer
    ? overlayLayers.find((layer) => layer.id === selectedFolderLayer)
    : undefined
  const selectedBlueprintFolder =
    selectedFolder && selectedBlueprintLayer
      ? selectedBlueprintLayer.folders[selectedFolder]
      : undefined
  const blueprintFolderFiles = selectedBlueprintLayer
    ? Object.keys(selectedBlueprintLayer.files)
        .filter((id) => folderOfFile(id) === selectedFolder)
        .map((id) => {
          const file = graph.files.find((item) => item.id === id)
          return {
            id,
            name: file?.name ?? id.split('/').pop() ?? id,
            userCreated: file?.userCreated,
          }
        })
        .sort((left, right) => left.name.localeCompare(right.name))
    : []
  const blueprintFolderChildren = selectedBlueprintLayer
    ? Object.values(selectedBlueprintLayer.folders)
        .filter(
          (folder) =>
            folder.path !== selectedFolder &&
            folderParent(folder.path) === selectedFolder,
        )
        .map((folder) => ({ path: folder.path, name: folder.name }))
        .sort((left, right) => left.name.localeCompare(right.name))
    : []
  const folderFiles = selectedBlueprintLayer
    ? blueprintFolderFiles
    : selectedFolderNode
      ? graph.files.filter(
          (file) =>
            selectedFolderNode.files.includes(file.id) ||
            file.folder === selectedFolderNode.path,
        )
      : []
  const folderChildren = selectedBlueprintLayer
    ? blueprintFolderChildren
    : selectedFolderNode
      ? graph.folders
          .filter((folder) => folder.parent === selectedFolderNode.path)
          .map((folder) => ({ path: folder.path, name: folder.name }))
      : []
  const folderInfoName =
    selectedFolderNode?.name ??
    selectedBlueprintFolder?.name ??
    selectedFolder ??
    ''
  const selectedFileBlueprintHex =
    selected?.colorHex ??
    [...overlayLayers]
      .reverse()
      .find((layer) => selected && layer.files[selected.id])?.colorHex ??
    null
  const selectedFileBlueprintColor =
    selected
      ? [...overlayLayers]
          .reverse()
          .find((layer) => layer.files[selected.id])?.id ??
        (selected.userCreated ? blueprintColor : null)
      : null
  const selectedFolderBlueprintHex = selectedBlueprintLayer?.colorHex ?? null
  const blueprintOptionName = selectedFolderLayer
    ? blueprintOptions.find((option) => option.id === selectedFolderLayer)
        ?.name
    : null
  const importers = selected
    ? graph.files.filter((file) => file.imports.includes(selected.id))
    : []
  const mapping = mode === 'map'
  const sessions = (intents ?? [intent]).filter(
    (item) => item.sessionId && isReviewingIntent(item.status),
  )
  const sessionTabs = [...sessions].sort((left, right) =>
    compareSessionColorOrder(left.color, right.color),
  )
  const activeBlueprint =
    blueprintOptions.find((option) => option.id === blueprintColor) ??
    SESSION_COLORS.find((color) => color.id === blueprintColor) ??
    null
  const nextAttachSession =
    sessions.find((session) => session.sessionId === nextAttachSessionId) ??
    [...sessions].reverse().find((session) => session.awaitingAttach) ??
    null
  const colorSession = blueprintColor
    ? sessions.find((session) => session.color === blueprintColor) ??
      (intent.color === blueprintColor &&
      intent.sessionId &&
      isReviewingIntent(intent.status)
        ? intent
        : null)
    : null
  const sessionPanelIntent =
    colorSession ??
    (blueprintColor ? waitingColorIntent(blueprintColor) : null)
  const [colorPage, setColorPage] = useState(() =>
    sessionColorPageIndex(intent.color),
  )
  const colorPageCount = sessionColorPageCount()
  useEffect(() => {
    setColorPage(sessionColorPageIndex(intent.color))
  }, [intent.sessionId, intent.color])
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
  const [actionsMenuPosition, setActionsMenuPosition] = useState<CSSProperties>()
  const actionsMenuRef = useRef<HTMLDivElement>(null)
  const [relationsMenuOpen, setRelationsMenuOpen] = useState(false)
  const [relationsMenuPosition, setRelationsMenuPosition] = useState<CSSProperties>()
  const relationsMenuRef = useRef<HTMLDivElement>(null)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [branchMenuPosition, setBranchMenuPosition] = useState<CSSProperties>()
  const branchMenuRef = useRef<HTMLDivElement>(null)
  const [noteEditor, setNoteEditor] = useState<{
    file: string
    kind: BlueprintNoteKind
    name?: string
    title: string
    subtitle: string
    placeholder: string
  } | null>(null)
  const [pointPicker, setPointPicker] = useState<{
    kind: 'file' | 'folder'
    path: string
    title: string
    subtitle: string
  } | null>(null)
  const [colorPicker, setColorPicker] = useState<{
    kind: 'file' | 'folder'
    path: string
    title: string
    subtitle: string
    currentColor?: string | null
  } | null>(null)
  const [blueprintFileDialog, setBlueprintFileDialog] = useState<
    null | 'save' | 'save-as' | 'load'
  >(null)
  const [blueprintFileBusy, setBlueprintFileBusy] = useState(false)
  const [blueprintFileError, setBlueprintFileError] = useState<string | null>(
    null,
  )
  const [savedBlueprintList, setSavedBlueprintList] = useState<{
    directory: string
    items: SavedBlueprintListItem[]
  }>({ directory: 'blueprints', items: [] })
  const [infoVisible, setInfoVisible] = useState(false)
  const [infoMinimized, setInfoMinimized] = useState(false)
  const [leftPanelsHidden, setLeftPanelsHidden] = useState(false)
  const [rightPanelsHidden, setRightPanelsHidden] = useState(false)
  const infoPanelRef = useRef<HTMLDivElement>(null)
  const canPlace = true
  const closeBlueprintFileDialog = () => {
    if (blueprintFileBusy) return
    setBlueprintFileDialog(null)
    setBlueprintFileError(null)
  }
  const runSaveBlueprint = async (
    input: SaveBlueprintInput,
    openOnError = false,
  ) => {
    if (!onSaveBlueprint) return
    setBlueprintFileBusy(true)
    setBlueprintFileError(null)
    try {
      await onSaveBlueprint(input)
      setBlueprintFileDialog(null)
    } catch (error) {
      setBlueprintFileError(
        error instanceof Error ? error.message : 'Could not save blueprint',
      )
      if (openOnError) setBlueprintFileDialog('save')
    } finally {
      setBlueprintFileBusy(false)
    }
  }
  const runLoadBlueprint = async (input: LoadBlueprintInput) => {
    if (!onLoadBlueprint) return
    setBlueprintFileBusy(true)
    setBlueprintFileError(null)
    try {
      await onLoadBlueprint(input)
      setBlueprintFileDialog(null)
    } catch (error) {
      setBlueprintFileError(
        error instanceof Error ? error.message : 'Could not load blueprint',
      )
    } finally {
      setBlueprintFileBusy(false)
    }
  }
  const openLoadBlueprint = () => {
    setBlueprintFileError(null)
    setBlueprintFileDialog('load')
    void fetchSavedBlueprints()
      .then(setSavedBlueprintList)
      .catch((error) => {
        setBlueprintFileError(
          error instanceof Error ? error.message : 'Could not list blueprints',
        )
      })
  }
  const overlay =
    hideChanges
      ? emptyIntent
      : showBranchChanges && branchChanges
        ? branchChanges
        : intent
  const previewing =
    !hideChanges && (intent.preview || showBranchChanges)
  const llmChangeOverlay =
    !hideChanges && !showBranchChanges && previewing ? overlay : null
  const llmChangeReason = intent.reason || intent.feature || ''
  const llmChangeColor = intent.colorName?.trim() || 'LLM'
  const selectedFileChangeKind = selected && llmChangeOverlay
    ? overlayPathChangeKind(llmChangeOverlay, selected.id)
    : null
  const selectedFileLlmNote =
    selected && selectedFileChangeKind && llmChangeOverlay
      ? llmChangeNoteForPath(llmChangeOverlay, selected.id, {
          reason: llmChangeReason,
        })
      : ''
  const selectedFolderPath =
    selectedFolderNode?.path ?? selectedFolder ?? ''
  const selectedFolderChangeKind =
    !selected && selectedFolderPath && llmChangeOverlay
      ? overlayPathChangeKind(llmChangeOverlay, selectedFolderPath, true)
      : null
  const selectedFolderLlmNote =
    selectedFolderChangeKind && llmChangeOverlay
      ? llmChangeNoteForPath(llmChangeOverlay, selectedFolderPath, {
          folder: true,
          reason: llmChangeReason,
        })
      : ''
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
  const canRenameSelectedFile =
    Boolean(onRenameCreatedFile) &&
    canDeleteSelected &&
    Boolean(selected) &&
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
  const folderPath = selectedFolderNode?.path ?? selectedFolder ?? ''
  const canRenameSelectedFolder =
    Boolean(onRenameCreatedFolder) &&
    canDeleteSelected &&
    !selected &&
    Boolean(folderPath) &&
    folderPath !== '.' &&
    !folderPath.startsWith('draft:')
  const renameSelectedFolder = (nextName: string) => {
    if (!folderPath || !onRenameCreatedFolder) return false
    const previous = folderPath
    const nextPath = onRenameCreatedFolder(previous, nextName)
    if (!nextPath) return false
    setNoteEditor((current) => {
      if (!current) return current
      if (
        current.file !== previous &&
        !current.file.startsWith(`${previous}/`)
      ) {
        return current
      }
      const file =
        current.file === previous
          ? nextPath
          : `${nextPath}${current.file.slice(previous.length)}`
      return { ...current, file }
    })
    return true
  }
  const selectedFolderNote = folderPath
    ? findBlueprintNote(blueprintNotes, folderPath, 'folder')
    : ''
  const openFileNoteFor = (fileId: string) => {
    if (!onSetBlueprintNote || fileId.startsWith('draft:')) return
    const file = graph.files.find((item) => item.id === fileId)
    const name = file?.name ?? fileId.split('/').pop() ?? fileId
    const path = file?.path ?? fileId
    setInstructionsOpen(false)
    setPointPicker(null)
    setColorPicker(null)
    setNoteEditor({
      file: fileId,
      kind: 'file',
      title: `Note · ${name}`,
      subtitle: path,
      placeholder: 'Extra instructions or pseudo code for this file',
    })
  }
  const openFileNote = () => {
    if (!selected) return
    openFileNoteFor(selected.id)
  }
  const openFolderNoteFor = (path: string) => {
    if (!onSetBlueprintNote || !path || path.startsWith('draft:')) return
    const name =
      path === '.' ? graph.targetName : path.split('/').pop() ?? path
    setInstructionsOpen(false)
    setPointPicker(null)
    setColorPicker(null)
    setNoteEditor({
      file: path,
      kind: 'folder',
      title: `Note · ${name}`,
      subtitle: path,
      placeholder: 'Extra instructions or pseudo code for this folder',
    })
  }
  const openFolderNote = () => {
    if (!folderPath) return
    openFolderNoteFor(folderPath)
  }
  const openFilePointer = () => {
    if (!selected || !onToggleBlueprintPointer) return
    setInstructionsOpen(false)
    setNoteEditor(null)
    setColorPicker(null)
    setPointPicker({
      kind: 'file',
      path: selected.id,
      title: 'Point to file',
      subtitle: selected.path,
    })
  }
  const openFolderPointer = () => {
    if (!folderPath || !onToggleBlueprintPointer) return
    setInstructionsOpen(false)
    setNoteEditor(null)
    setColorPicker(null)
    setPointPicker({
      kind: 'folder',
      path: folderPath,
      title: 'Point to folder',
      subtitle: folderPath,
    })
  }
  const openFileColor = () => {
    if (!selected || !onChangeCreatedColor || selected.id.startsWith('draft:')) {
      return
    }
    setInstructionsOpen(false)
    setNoteEditor(null)
    setPointPicker(null)
    setColorPicker({
      kind: 'file',
      path: selected.id,
      title: 'Change blueprint color',
      subtitle: selected.path,
      currentColor: selectedFileBlueprintColor,
    })
  }
  const openFolderColor = () => {
    if (!folderPath || !onChangeCreatedColor || folderPath.startsWith('draft:')) {
      return
    }
    setInstructionsOpen(false)
    setNoteEditor(null)
    setPointPicker(null)
    setColorPicker({
      kind: 'folder',
      path: folderPath,
      title: 'Change blueprint color',
      subtitle: folderPath,
      currentColor:
        selectedFolderLayer ??
        overlayLayers.find((layer) => layer.folders[folderPath])?.id,
    })
  }
  const openSymbolNote = (
    kind: 'function' | 'variable',
    name: string,
  ) => {
    if (!selected || !onSetBlueprintNote) return
    setInstructionsOpen(false)
    setPointPicker(null)
    setColorPicker(null)
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
  const selectedFileMenuItems: InfoMenuItem[] = selected
    ? [
        ...(canInspectFile(selected.id, selected.userCreated)
          ? [
              {
                key: 'inspect',
                label: 'Inspect file',
                onClick: () => onInspectFile?.(selected.id),
              },
            ]
          : []),
        ...(canEditBlueprint && onToggleBlueprintPointer
          ? pointerMenuItem(
              { kind: 'file', path: selected.id },
              blueprintColorPointers,
              openFilePointer,
            )
          : []),
        ...(canEditBlueprint && onSetBlueprintNote
          ? [
              {
                key: 'note',
                label: selectedFileNote ? 'Edit file note' : 'Add file note',
                active:
                  noteEditor?.kind === 'file' && noteEditor.file === selected.id,
                onClick: openFileNote,
              },
            ]
          : []),
        ...(canPlace &&
        onChangeCreatedColor &&
        canDeleteSelected &&
        !selected.id.startsWith('draft:')
          ? [
              {
                key: 'color',
                label: 'Change blueprint color',
                active: colorPicker?.kind === 'file' && colorPicker.path === selected.id,
                disabled: naming,
                onClick: openFileColor,
              },
            ]
          : []),
      ]
      : []
  const selectedFolderMenuItems: InfoMenuItem[] =
    !selected && (selectedFolderNode || selectedBlueprintFolder)
      ? [
          ...(canPlace && onToggleBlueprintPointer && folderPath
            ? pointerMenuItem(
                { kind: 'folder', path: folderPath },
                blueprintColorPointers,
                openFolderPointer,
                naming || folderPath.startsWith('draft:'),
              )
            : []),
          ...(canPlace &&
          onSetBlueprintNote &&
          folderPath &&
          !folderPath.startsWith('draft:')
            ? [
                {
                  key: 'note',
                  label: selectedFolderNote
                    ? 'Edit folder note'
                    : 'Add folder note',
                  active:
                    noteEditor?.kind === 'folder' &&
                    noteEditor.file === folderPath,
                  disabled: naming,
                  onClick: openFolderNote,
                },
              ]
            : []),
          ...(canPlace &&
          onChangeCreatedColor &&
          canDeleteSelected &&
          folderPath &&
          !folderPath.startsWith('draft:')
            ? [
                {
                  key: 'color',
                  label: 'Change blueprint color',
                  active:
                    colorPicker?.kind === 'folder' &&
                    colorPicker.path === folderPath,
                  disabled: naming,
                  onClick: openFolderColor,
                },
              ]
            : []),
          ...(canPlace && mapping && onMapAddFile && onMapAddFolder && selectedFolder
            ? [
                {
                  key: 'add-file',
                  label: 'Add file',
                  disabled: naming,
                  onClick: () =>
                    onMapAddFile(
                      selectedFolderNode?.path ?? selectedFolder,
                      selectedFolderLayer ?? undefined,
                    ),
                },
                {
                  key: 'add-folder',
                  label: 'Add folder',
                  disabled: naming,
                  onClick: () =>
                    onMapAddFolder(
                      selectedFolderNode?.path ?? selectedFolder,
                      selectedFolderLayer ?? undefined,
                    ),
                },
              ]
            : []),
        ]
      : []

  useEffect(() => {
    infoPanelRef.current?.scrollTo({ top: 0 })
  }, [selectedId, selectedFolder, selectedFolderLayer])

  useEffect(() => {
    setPointPicker(null)
    setColorPicker(null)
  }, [selectedId, selectedFolder, selectedFolderLayer])

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
    if (fileNoteTick <= 0 || !selectedId) return
    openFileNoteFor(selectedId)
  }, [fileNoteTick])

  useEffect(() => {
    if (folderNoteTick <= 0 || !selectedFolder) return
    openFolderNoteFor(selectedFolder)
  }, [folderNoteTick])

  useEffect(() => {
    if (fileColorTick <= 0 || !selectedId) return
    openFileColor()
  }, [fileColorTick])

  useEffect(() => {
    if (folderColorTick <= 0 || !selectedFolder) return
    openFolderColor()
  }, [folderColorTick])

  useEffect(() => {
    if (selectedFolder) setInfoVisible(true)
  }, [selectedFolder, selectedFolderLayer])

  useEffect(() => {
    if (!locked) return
    setInfoVisible(false)
    setInfoMinimized(false)
  }, [locked])

  useEffect(() => {
    if (infoVisible || !importPickActive) return
    onCancelImportPick?.()
  }, [importPickActive, infoVisible, onCancelImportPick])

  const infoOpen =
    infoVisible &&
    !rightPanelsHidden &&
    Boolean(selected || selectedFolderNode || selectedBlueprintFolder)

  useEffect(() => {
    if (infoOpen) document.exitPointerLock()
  }, [infoOpen])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'KeyI') return
      if (shouldIgnoreShortcut(event)) return
      event.preventDefault()
      if (rightPanelsHidden) {
        setRightPanelsHidden(false)
        if (!infoVisible) {
          setInfoMinimized(false)
          setInfoVisible(true)
        }
        return
      }
      if (infoVisible) {
        setInfoVisible(false)
        setInfoMinimized(false)
        return
      }
      setInfoMinimized(false)
      setInfoVisible(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [infoVisible, rightPanelsHidden])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
      if (shouldIgnoreShortcut(event)) return
      if (event.code === 'BracketLeft') {
        event.preventDefault()
        setLeftPanelsHidden((current) => !current)
        return
      }
      if (event.code === 'BracketRight') {
        event.preventDefault()
        setRightPanelsHidden((current) => !current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
    setRelationsMenuOpen(false)
    setBranchMenuOpen(false)
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

  useLayoutEffect(() => {
    if (!relationsMenuOpen) return
    const updatePosition = () => {
      const trigger = relationsMenuRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      setRelationsMenuPosition({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 8,
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [relationsMenuOpen])

  useLayoutEffect(() => {
    if (!branchMenuOpen) return
    const updatePosition = () => {
      const trigger = branchMenuRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      setBranchMenuPosition({
        right: window.innerWidth - rect.right,
        bottom: window.innerHeight - rect.top + 8,
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [branchMenuOpen])

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

  useEffect(() => {
    if (!relationsMenuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return
      if (shouldIgnoreShortcut(event)) return
      event.preventDefault()
      event.stopPropagation()
      setRelationsMenuOpen(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Element &&
        (relationsMenuRef.current?.contains(target) ||
          target.closest('[data-relations-menu]'))
      ) {
        return
      }
      setRelationsMenuOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [relationsMenuOpen])

  useEffect(() => {
    if (!branchMenuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return
      if (shouldIgnoreShortcut(event)) return
      event.preventDefault()
      event.stopPropagation()
      setBranchMenuOpen(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Element &&
        (branchMenuRef.current?.contains(target) ||
          target.closest('[data-branch-menu]'))
      ) {
        return
      }
      setBranchMenuOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [branchMenuOpen])

  useEffect(() => {
    if (canShowBranchChanges) return
    setBranchMenuOpen(false)
  }, [canShowBranchChanges])

  useEffect(() => {
    if (!explainMode) return
    setActionsMenuOpen(false)
    setInstructionsOpen(false)
    setNoteEditor(null)
    setPointPicker(null)
    setColorPicker(null)
    setBlueprintFileDialog(null)
  }, [explainMode])

  const canToggleImportedBy = Boolean(selectedId)
  const instructionSections = explorerInstructions({
    canPlace,
    hasChangeSet,
    changePathsOnly,
    selectedUserCreated:
      canDeleteSelected ||
      Boolean(selected?.userCreated) ||
      Boolean(selectedFolderNode?.userCreated),
    infoVisible,
    importedBy,
    canToggleImportedBy,
    relationMode,
    showBranchChanges,
    canShowBranchChanges,
    showHiddenFiles,
    leftPanelsHidden,
    rightPanelsHidden,
  })
  const currentInstructionView: InstructionView = mapping ? 'map' : 'walk'
  const modeButtons = (
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
  )
  if (!mapping) {
    return (
      <div className="hud">
        {locked && <div className="crosshair" />}
        <div className="hud-walk-bar">
          <p className="hud-walk-hint">
            Hit <kbd>Space</kbd> to jump to the crosshair. Hit <kbd>Esc</kbd> to
            return to map
          </p>
          {modeButtons}
        </div>
      </div>
    )
  }
  const bottomBarInactive = explainMode
  return (
    <div className="hud">
      {!explainMode && addingKind && addingParent && onCommitAdd && onCancelAdd && (
        <AddItemModal
          key={`${addingKind}:${addingParent}:${addingLockedColor ?? addingInitialColor ?? ''}`}
          kind={addingKind}
          parentLabel={
            addingParent === '.' ? graph.targetName : addingParent
          }
          options={blueprintOptions}
          visibleColors={blueprintColors}
          currentColor={blueprintColor}
          lockedColor={addingLockedColor}
          initialColor={addingInitialColor}
          onCommit={onCommitAdd}
          onCancel={onCancelAdd}
        />
      )}

      {!explainMode && (
      <div className="hud-top">
        <div className="hud-top-left-tools">
          <HidePanelsButton
            side="left"
            hidden={leftPanelsHidden}
            onToggle={() => setLeftPanelsHidden((current) => !current)}
          />
        </div>
        <div className="hud-top-end">
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
          {modeButtons}
          <HidePanelsButton
            side="right"
            hidden={rightPanelsHidden}
            onToggle={() => setRightPanelsHidden((current) => !current)}
          />
        </div>
      </div>
      )}

      {!explainMode && (onSelectBlueprintColor || sessions.length > 0) && (
        <div className="hud-left-stack" hidden={leftPanelsHidden}>
          {onSelectBlueprintColor && (
            <div
              className="hud-session-tabs"
              role="tablist"
              aria-label="LLM sessions"
            >
              {sessionColorsOnPage(colorPage).map((color) => {
                  const session = sessionTabs.find(
                    (item) => item.color === color.id,
                  )
                  const active = color.id === blueprintColor
                  const attached = session?.awaitingAttach === false
                  const busy = Boolean(session && sessionLiveStatus(session).busy)
                  const label =
                    (session ? sessionDisplayName(session) : color.name) ||
                    color.name
                  const stateLabel = session
                    ? busy
                      ? 'LLM working'
                      : attached
                        ? 'Attached'
                        : 'Waiting'
                    : null
                  const baseLabel = stateLabel
                    ? `${label}, ${stateLabel}`
                    : `${color.name} blueprint`
                  return (
                    <button
                      className="hud-button hud-session-tab"
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-label={baseLabel}
                      data-active={active}
                      data-busy={busy ? true : undefined}
                      key={color.id}
                      title={
                        stateLabel
                          ? `${label} · ${stateLabel}`
                          : `${color.name} blueprint`
                      }
                      style={
                        {
                          '--session-color': color.hex,
                        } as CSSProperties
                      }
                      onClick={() => {
                        if (session?.sessionId)
                          onFocusSession?.(session.sessionId)
                        onSelectBlueprintColor(color.id)
                      }}
                    >
                      <SessionSwatch colorHex={color.hex} busy={busy} />
                    </button>
                  )
                })}
                <ColorPager
                  page={colorPage}
                  pageCount={colorPageCount}
                  onPageChange={setColorPage}
                />
              </div>
          )}
          {sessionPanelIntent && (
            <SessionPanel
              intent={sessionPanelIntent}
              focused
              naming={naming}
              nextAttachSession={nextAttachSession}
              onFocus={() => {
                if (
                  sessionPanelIntent.sessionId &&
                  !isPendingSessionId(sessionPanelIntent.sessionId)
                ) {
                  onFocusSession?.(sessionPanelIntent.sessionId)
                }
              }}
              onWorkflowAction={onWorkflowAction}
              onNavigateDiff={onNavigateDiff}
            />
          )}
        </div>
      )}

      {!explainMode && (
      <>
      <div className="hud-right-stack" hidden={rightPanelsHidden}>
      {selected && infoVisible && (
        <aside
          className="hud-panel hud-panel-info"
          data-minimized={infoMinimized}
          data-blueprint={selectedFileBlueprintHex ? 'true' : undefined}
          style={infoBlueprintStyle(selectedFileBlueprintHex)}
        >
          <PanelChrome
            title={
              <InfoKindTitle
                kind="file"
                openLabel={selected.name}
                onOpen={
                  canInspectFile(selected.id, selected.userCreated)
                    ? () => onInspectFile?.(selected.id)
                    : undefined
                }
              >
                {canRenameSelectedFile ? (
                  <InfoNameField
                    key={selected.id}
                    name={selected.name}
                    onRename={renameSelectedFile}
                  />
                ) : (
                  selected.name
                )}
              </InfoKindTitle>
            }
            subtitle={
              selected.binary
                ? `${selected.path} (binary)`
                : `${selected.path} (${selected.lines} ${
                    selected.lines === 1 ? 'line' : 'lines'
                  })`
            }
            minimized={infoMinimized}
            onMinimize={() => setInfoMinimized((current) => !current)}
            menu={
              <InfoActionsMenu
                key={selected.id}
                items={selectedFileMenuItems}
              />
            }
          />
          {!infoMinimized && (
            <div ref={infoPanelRef} className="hud-panel-body">
          {previewing &&
          selectedFileChangeKind &&
          selectedFileLlmNote &&
          !showBranchChanges ? (
            <>
              <div className="hud-section-title">
                LLM changes
              </div>
              <LlmChangeNote
                colorName={llmChangeColor}
                colorHex={intent.colorHex}
                note={selectedFileLlmNote}
              />
            </>
          ) : null}
          {previewing &&
            showBranchChanges &&
            (selectedChangedFunctions.length > 0 ||
              selectedAddedFunctions.length > 0 ||
              selectedChangedVariables.length > 0 ||
              selectedAddedVariables.length > 0 ||
              selectedAddedImports.length > 0) && (
              <>
                <div className="hud-section-title hud-section-title-edit">
                  Branch changes
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
          {!selected.binary && selectedClasses.length > 0 && (
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
                  </li>
                ))}
              </ul>
            </>
          )}
          {!selected.binary && (
            <>
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
            </>
          )}
          {(!selected.binary || importedBy) && (
            <>
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
                    <button
                      className="hud-item-select"
                      type="button"
                      onClick={() => onInspectBlock?.(file.id)}
                    >
                      {file.name}
                    </button>
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
                  <button
                    className={
                      intendedImportFrom.has(id)
                        ? 'hud-item-select hud-intended'
                        : 'hud-item-select'
                    }
                    type="button"
                    title={id}
                    onClick={() => onInspectBlock?.(id)}
                  >
                    {fileBase(id)}
                  </button>
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
            </>
          )}
            </div>
          )}
        </aside>
      )}

      {!selected &&
        (selectedFolderNode || selectedBlueprintFolder) &&
        infoVisible && (
        <aside
          className="hud-panel hud-panel-info"
          data-minimized={infoMinimized}
          data-blueprint={selectedFolderBlueprintHex ? 'true' : undefined}
          style={infoBlueprintStyle(selectedFolderBlueprintHex)}
        >
          <PanelChrome
            title={
              <InfoKindTitle kind="folder">
                {canRenameSelectedFolder ? (
                  <InfoNameField
                    key={folderPath}
                    kind="folder"
                    name={folderInfoName}
                    onRename={renameSelectedFolder}
                  />
                ) : (
                  folderInfoName
                )}
              </InfoKindTitle>
            }
            subtitle={
              <>
                {(selectedFolderNode?.path ?? selectedFolder) === '.'
                  ? graph.targetName
                  : (selectedFolderNode?.path ?? selectedFolder)}
                {selectedBlueprintLayer
                  ? ` · ${blueprintOptionName ?? 'Blueprint'} template`
                  : ''}
              </>
            }
            minimized={infoMinimized}
            onMinimize={() => setInfoMinimized((current) => !current)}
            menu={
              <InfoActionsMenu
                key={folderPath || 'folder'}
                items={selectedFolderMenuItems}
              />
            }
          />
          {!infoMinimized && (
            <div ref={infoPanelRef} className="hud-panel-body">
          {selectedFolderChangeKind && selectedFolderLlmNote ? (
            <>
              <div className="hud-section-title">
                LLM changes
              </div>
              <LlmChangeNote
                colorName={llmChangeColor}
                colorHex={intent.colorHex}
                note={selectedFolderLlmNote}
              />
            </>
          ) : null}
          {folderChildren.length > 0 && (
            <>
              <div className="hud-section-title">
                Folders ({folderChildren.length})
              </div>
              <ul>
                {folderChildren.map((folder) => (
                  <li key={folder.path}>
                    {onSelectFolder ? (
                      <button
                        className="hud-item-select hud-item-kind"
                        type="button"
                        onClick={() =>
                          onSelectFolder(folder.path, selectedFolderLayer)
                        }
                      >
                        <FolderIcon />
                        <span>{folder.name}</span>
                      </button>
                    ) : (
                      <span className="hud-item-kind">
                        <FolderIcon />
                        <span>{folder.name}</span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="hud-section-title">
            Files ({folderFiles.length})
          </div>
          {folderFiles.length === 0 ? (
            <p>
              {selectedBlueprintLayer
                ? 'No files on this blueprint'
                : 'No files in this folder'}
            </p>
          ) : (
            <ul>
              {folderFiles.map((file) => (
                <li key={file.id}>
                  <button
                    className="hud-item-select hud-item-kind"
                    type="button"
                    onClick={() => onInspectBlock?.(file.id)}
                  >
                    <FileIcon />
                    <span>{file.name}</span>
                  </button>
                  {canInspectFile(file.id, file.userCreated) && (
                    <div className="hud-item-actions">
                      <button
                        className="hud-item-inspect"
                        type="button"
                        onClick={() => onInspectFile?.(file.id)}
                      >
                        Inspect
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
            </div>
          )}
        </aside>
      )}
      </div>

      {pointPicker && onToggleBlueprintPointer && (
        <BlueprintPointModal
          title={pointPicker.title}
          subtitle={pointPicker.subtitle}
          target={{ kind: pointPicker.kind, path: pointPicker.path }}
          colorPointers={blueprintColorPointers}
          onToggle={(color) =>
            onToggleBlueprintPointer({
              kind: pointPicker.kind,
              path: pointPicker.path,
              color,
            })
          }
          onClose={() => setPointPicker(null)}
        />
      )}

      {colorPicker && onChangeCreatedColor && (
        <BlueprintColorModal
          title={colorPicker.title}
          subtitle={colorPicker.subtitle}
          options={blueprintOptions}
          currentColor={colorPicker.currentColor}
          onSelect={(color) =>
            onChangeCreatedColor({
              kind: colorPicker.kind,
              path: colorPicker.path,
              color,
            })
          }
          onClose={() => setColorPicker(null)}
        />
      )}

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

      {(blueprintFileDialog === 'save' || blueprintFileDialog === 'save-as') &&
        onSaveBlueprint && (
          <BlueprintSaveDialog
            mode={blueprintFileDialog}
            defaultName={savedBlueprint?.name ?? ''}
            defaultDirectory="blueprints"
            busy={blueprintFileBusy}
            error={blueprintFileError}
            onSubmit={(input) => void runSaveBlueprint(input)}
            onClose={closeBlueprintFileDialog}
          />
        )}
      {blueprintFileDialog === 'load' && onLoadBlueprint && (
        <BlueprintLoadDialog
          directory={savedBlueprintList.directory}
          items={savedBlueprintList.items}
          busy={blueprintFileBusy}
          error={blueprintFileError}
          onLoad={(item) =>
            void runLoadBlueprint({
              name: item.name,
              filePath: item.path,
            })
          }
          onLoadDocument={(document) => void runLoadBlueprint({ document })}
          onClose={closeBlueprintFileDialog}
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
      </>
      )}

      <div
        className="hud-bottom"
        data-explain={explainMode ? 'true' : undefined}
      >
        <div
          className="hud-bottom-actions"
          data-inactive={bottomBarInactive ? 'true' : undefined}
          aria-disabled={bottomBarInactive}
        >
          {activeBlueprint && (
            <span
              className="hud-blueprint-active"
              title={`${activeBlueprint.name} blueprint`}
              aria-label={`Active blueprint: ${activeBlueprint.name}`}
            >
              <SessionSwatch
                colorHex={activeBlueprint.hex}
                className="hud-session-swatch hud-blueprint-swatch"
              />
            </span>
          )}
          <label
            className="hud-button hud-blueprint-opacity"
            title={
              bottomBarInactive
                ? 'Unavailable in explain mode'
                : 'Blueprint overlay opacity'
            }
          >
            <span className="hud-blueprint-opacity-label">Opacity</span>
            <input
              className="hud-blueprint-opacity-slider"
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(blueprintOpacity * 100)}
              aria-label="Blueprint overlay opacity"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(blueprintOpacity * 100)}
              disabled={bottomBarInactive}
              onChange={(event) =>
                onBlueprintOpacityChange?.(Number(event.target.value) / 100)
              }
            />
            <span className="hud-blueprint-opacity-value">
              {Math.round(blueprintOpacity * 100)}%
            </span>
          </label>
          {onClearBlueprint && (
            <button
              className="hud-button"
              type="button"
              aria-label="Clear the active blueprint"
              title={
                bottomBarInactive
                  ? 'Unavailable in explain mode'
                  : 'Remove planned files, folders, and symbols on the active color'
              }
              disabled={bottomBarInactive || !blueprintHasContent}
              onClick={onClearBlueprint}
            >
              Clear
            </button>
          )}
          {onCleanupBlueprint && (
            <button
              className="hud-button"
              type="button"
              aria-label="Cleanup the active blueprint"
              title={
                bottomBarInactive
                  ? 'Unavailable in explain mode'
                  : 'Remove existing files and folders on the active color'
              }
              disabled={bottomBarInactive || !blueprintCanCleanup}
              onClick={onCleanupBlueprint}
            >
              Cleanup
            </button>
          )}
          {onToggleBlueprintHidden && (
            <button
              className="hud-button"
              type="button"
              aria-label={
                blueprintColor && !blueprintColors.includes(blueprintColor)
                  ? 'Show the active blueprint'
                  : 'Hide the active blueprint'
              }
              title={
                bottomBarInactive
                  ? 'Unavailable in explain mode'
                  : blueprintColor && !blueprintColors.includes(blueprintColor)
                    ? 'Show the active blueprint overlay'
                    : 'Hide the active blueprint overlay'
              }
              disabled={bottomBarInactive}
              onClick={onToggleBlueprintHidden}
            >
              {blueprintColor && !blueprintColors.includes(blueprintColor)
                ? 'Show'
                : 'Hide'}
            </button>
          )}
        </div>
        <div className="hud-icon-row">
          {!bottomBarInactive &&
            onWalkDropStart &&
            onWalkDropMove &&
            onWalkDropEnd && (
            <WalkDrop
              cursor={walkDrop}
              onStart={onWalkDropStart}
              onMove={onWalkDropMove}
              onEnd={onWalkDropEnd}
            />
          )}
          {onRelationModeChange && (
            <div className="hud-actions-menu" ref={relationsMenuRef}>
              <button
                className="hud-button hud-icon-button"
                data-active={relationMode !== 'off'}
                aria-label={`Relations, ${
                  RELATION_MODE_OPTIONS.find((option) => option.id === relationMode)
                    ?.label ?? 'Off'
                }`}
                aria-keyshortcuts="R"
                aria-haspopup="menu"
                aria-expanded={relationsMenuOpen}
                type="button"
                onClick={() => {
                  setActionsMenuOpen(false)
                  setBranchMenuOpen(false)
                  setRelationsMenuOpen((open) => !open)
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
                  <rect x="3" y="4" width="5" height="6" rx="1" />
                  <rect x="16" y="4" width="5" height="6" rx="1" />
                  <rect x="3" y="14" width="5" height="6" rx="1" />
                  <rect x="16" y="14" width="5" height="6" rx="1" />
                  <path d="M8 7h8" />
                  <path d="M8 17h8" />
                  <path d="M5.5 10v4" />
                  <path d="M18.5 10v4" />
                </svg>
                <span className="hud-tooltip">
                  {`R relations · ${
                    RELATION_MODE_OPTIONS.find((option) => option.id === relationMode)
                      ?.label ?? 'Off'
                  }`}
                </span>
              </button>
              {relationsMenuOpen &&
                relationsMenuPosition &&
                createPortal(
                  <div
                    className="hud-actions-menu-list"
                    data-relations-menu="true"
                    role="menu"
                    aria-label="Relations"
                    style={relationsMenuPosition}
                  >
                    {relationModesForView(mapping, relationMode).map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={relationMode === option.id}
                        data-active={relationMode === option.id}
                        onClick={() => {
                          onRelationModeChange(option.id)
                          setRelationsMenuOpen(false)
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>,
                  document.body,
                )}
            </div>
          )}
          {!bottomBarInactive &&
            mapping &&
            hasChangeSet &&
            onToggleChangePathsOnly && (
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
          {!bottomBarInactive && (
          <button
            className="hud-button hud-icon-button"
            data-active={importedBy && canToggleImportedBy}
            aria-label={
              !canToggleImportedBy
                ? 'Show imported by unavailable until a file is selected'
                : importedBy
                  ? 'Show imports'
                  : 'Show imported by'
            }
            aria-keyshortcuts="K"
            aria-pressed={importedBy && canToggleImportedBy}
            aria-disabled={!canToggleImportedBy}
            type="button"
            onClick={() => {
              if (!canToggleImportedBy) return
              onToggleImportedBy()
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
              <rect x="13" y="6" width="8" height="12" rx="1.5" />
              <path d="M3 12h8" />
              <path d="M8 8l4 4-4 4" />
            </svg>
            <span className="hud-tooltip">
              {!canToggleImportedBy
                ? 'Select a file to show imported by'
                : importedBy
                  ? 'K show imports'
                  : 'K show imported by'}
            </span>
          </button>
          )}
          <button
            className="hud-button hud-icon-button"
            data-active={showHiddenFiles}
            aria-label={
              showHiddenFiles ? 'Hide hidden files' : 'Show hidden files'
            }
            aria-keyshortcuts="H"
            aria-pressed={showHiddenFiles}
            type="button"
            onClick={() => onToggleShowHiddenFiles?.()}
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
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
              <path d="M14 2v6h6" />
              <circle cx="9" cy="14" r="1.7" fill="currentColor" stroke="none" />
            </svg>
            <span className="hud-tooltip">
              {showHiddenFiles ? 'H hide hidden files' : 'H show hidden files'}
            </span>
          </button>
          <div className="hud-actions-menu" ref={branchMenuRef}>
            <button
              className="hud-button hud-icon-button"
              data-active={showBranchChanges}
              aria-label={
                llmMakingChanges
                  ? 'Show branch changes unavailable while the LLM is making changes'
                  : 'Branch changes'
              }
              aria-keyshortcuts="G"
              aria-haspopup="dialog"
              aria-expanded={branchMenuOpen}
              aria-pressed={showBranchChanges}
              aria-disabled={!canShowBranchChanges}
              type="button"
              onClick={() => {
                if (!canShowBranchChanges) return
                setActionsMenuOpen(false)
                setRelationsMenuOpen(false)
                setBranchMenuOpen((open) => {
                  const next = !open
                  if (next && !wantBranchChanges) onToggleShowBranchChanges?.()
                  return next
                })
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
            {branchMenuOpen &&
              branchMenuPosition &&
              branchChanges &&
              createPortal(
                <div
                  className="hud-branch-menu-panel"
                  data-branch-menu="true"
                  role="dialog"
                  aria-label="Branch changes"
                  style={branchMenuPosition}
                >
                  <BranchChangesPanel
                    changes={branchChanges}
                    hideChanges={hideChanges}
                    onBaseChange={onBranchChangesBaseChange}
                    onToggleHideChanges={onToggleHideChanges}
                  />
                </div>,
                document.body,
              )}
          </div>
          {!bottomBarInactive && (
          <div className="hud-actions-menu" ref={actionsMenuRef}>
            <button
              className="hud-button hud-icon-button"
              data-active={actionsMenuOpen}
              type="button"
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={actionsMenuOpen}
              onClick={() => {
                setRelationsMenuOpen(false)
                setBranchMenuOpen(false)
                setActionsMenuOpen((open) => !open)
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
                  {onSaveBlueprint && (
                    <button
                      type="button"
                      role="menuitem"
                      aria-label={
                        savedBlueprint?.name
                          ? `Save blueprint ${savedBlueprint.name}`
                          : 'Save blueprint'
                      }
                      onClick={() => {
                        setActionsMenuOpen(false)
                        setBlueprintFileError(null)
                        if (savedBlueprint?.name && savedBlueprint.path) {
                          void runSaveBlueprint(
                            {
                              name: savedBlueprint.name,
                              filePath: savedBlueprint.path,
                            },
                            true,
                          )
                          return
                        }
                        setBlueprintFileDialog('save')
                      }}
                    >
                      Save blueprint
                    </button>
                  )}
                  {onSaveBlueprint && (
                    <button
                      type="button"
                      role="menuitem"
                      aria-label="Save blueprint as"
                      onClick={() => {
                        setActionsMenuOpen(false)
                        setBlueprintFileError(null)
                        setBlueprintFileDialog('save-as')
                      }}
                    >
                      Save blueprint as
                    </button>
                  )}
                  {onLoadBlueprint && (
                    <button
                      type="button"
                      role="menuitem"
                      aria-label="Load blueprint"
                      onClick={() => {
                        setActionsMenuOpen(false)
                        openLoadBlueprint()
                      }}
                    >
                      Load blueprint
                    </button>
                  )}
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
          )}
        </div>
      </div>
    </div>
  )
}
