import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NameInput } from './NameInput'
import { SelectionThumbnail } from '../scene/SelectionThumbnail'
import {
  canStopSession,
  isReviewingIntent,
  type AgentIntent,
  type AgentIntentStatus,
  type AimedRelation,
  type CodebaseGraph,
  type PatchImportAddition,
  type PatchSymbolAddition,
  type ViewMode,
  type WorldLayout,
  type WorkflowAction,
} from '../types'

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

function importLabels(items: PatchImportAddition[]) {
  const files = new Set(items.map((item) => item.file))
  const showFile = files.size > 1
  return items.map((item) => {
    const what =
      item.name === item.from ? item.from : `${item.name} from ${item.from}`
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
}: {
  placeholder: string
  onAdd: (value: string) => boolean
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
    </form>
  )
}

function PanelChrome({
  title,
  minimized = false,
  onMinimize,
  onClose,
}: {
  title: ReactNode
  minimized?: boolean
  onMinimize?: () => void
  onClose?: () => void
}) {
  return (
    <div className="hud-panel-chrome">
      <div className="hud-panel-chrome-title">{title}</div>
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

type SessionPanelProps = {
  intent: AgentIntent
  focused: boolean
  naming: boolean
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
  onFocus,
  onWorkflowAction,
  onNavigateDiff,
}: SessionPanelProps) {
  const [minimized, setMinimized] = useState(false)
  const [instruction, setInstruction] = useState('')
  const sessionId = intent.sessionId
  const pending = intent.status === 'pending' && intent.isActiveDiff
  const askingBlueprint = intent.status === 'blueprint_ask'
  const creatingBlueprint = intent.creationMode || intent.status === 'blueprint'
  const preparing = intent.status === 'preparing'
  const planReady = intent.status === 'planned'
  const working = intent.status === 'working' || intent.status === 'replanning'
  const previewing = intent.preview
  const chainIndex = intent.chainIndex ?? 0
  const previousDiff = intent.chain[chainIndex - 1]
  const nextDiff = intent.chain[chainIndex + 1]
  const stepLabel =
    intent.step && intent.steps?.length > 0
      ? `Step ${intent.step} of ${intent.steps.length}`
      : 'Patch'
  const lastStep =
    typeof intent.step === 'number' &&
    intent.steps.length > 0 &&
    intent.step >= intent.steps.length
  const stepByStep = intent.stepByStep !== false
  const addedFunctions = intent.addedFunctions ?? []
  const addedVariables = intent.addedVariables ?? []
  const addedImports = intent.addedImports ?? []
  const changedFunctions = intent.changedFunctions ?? []
  const changedVariables = intent.changedVariables ?? []
  const doneSteps = new Set(
    intent.status === 'finished'
      ? intent.steps.map((step) => step.index)
      : intent.chain
          .filter(
            (entry) =>
              entry.status === 'applied' || entry.status === 'extended',
          )
          .map((entry) => entry.step),
  )
  if (intent.status === 'approved' && typeof intent.step === 'number') {
    doneSteps.add(intent.step)
  }
  if (pending && typeof intent.step === 'number' && !lastStep) {
    doneSteps.add(intent.step)
  }
  const nextStep =
    intent.status === 'finished'
      ? null
      : (intent.steps.find((step) => !doneSteps.has(step.index)) ?? null)
  const canRunNext =
    Boolean(nextStep) && (planReady || pending) && !working
  const canComplete = pending && lastStep
  const panelDone =
    intent.status === 'finished' ||
    intent.status === 'approved' ||
    doneSteps.size > 0

  useEffect(() => {
    setInstruction('')
  }, [intent.diffId])

  if (!sessionId || !isReviewingIntent(intent.status)) return null

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
      onPointerDown={onFocus}
    >
      <PanelChrome
        title={reviewTitle(intent.status)}
        minimized={minimized}
        onMinimize={() => setMinimized((current) => !current)}
      />
      {!minimized && (
        <>
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
          {!stepByStep && (
            <p className="hud-mode-hint">
              LLM implements the full plan. You can still walk the diffs, then
              Complete.
            </p>
          )}
          {intent.feature && <p className="hud-feature">{intent.feature}</p>}
          {askingBlueprint ? (
            <>
              <p>
                {intent.canEnterBlueprint
                  ? 'Place files and folders for this chat, then send them as a blueprint for the LLM?'
                  : `Blueprint edit mode is active in another chat (${intent.blueprintSessionId}). Finish or stop it before starting here.`}
              </p>
              <div className="hud-decide">
                <button
                  className="hud-button hud-button-approve"
                  type="button"
                  disabled={!intent.canEnterBlueprint}
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
          ) : creatingBlueprint ? (
            <>
              <p>
                Walk the map, press <kbd>Space</kbd> for a file and{' '}
                <kbd>B</kbd> for an island. Send the blueprint when the layout
                is ready.
              </p>
              <div className="hud-decide">
                <button
                  className="hud-button hud-button-approve"
                  type="button"
                  disabled={naming}
                  onClick={() => act('blueprint_send')}
                >
                  Send blueprint
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
          ) : intent.status === 'finished' ? (
            <p>All plan steps were applied.</p>
          ) : preparing ? (
            <div className="hud-working">
              <span className="hud-spinner" aria-hidden="true" />
              <span>LLM preparing…</span>
              <button
                className="hud-button hud-button-reject"
                type="button"
                onClick={() => act('stop')}
              >
                Stop
              </button>
            </div>
          ) : working ? (
            <div className="hud-working">
              <span className="hud-spinner" aria-hidden="true" />
              <span>
                {intent.status === 'replanning'
                  ? 'Updating the remaining plan from your instruction…'
                  : intent.stalledWait
                    ? 'The LLM is still waiting on this step…'
                    : `Implementing ${stepLabel.toLowerCase()}…`}
              </span>
              <button
                className="hud-button hud-button-reject"
                type="button"
                onClick={() => act('stop')}
              >
                Stop
              </button>
            </div>
          ) : (
            <p>
              {stepLabel}
              {intent.reason ? ` · ${intent.reason}` : ''}
            </p>
          )}
          {!askingBlueprint && !creatingBlueprint && (
            <>
              {intent.steps?.length > 0 && (
                <ol className="hud-steps">
                  {intent.steps.map((step) => (
                    <li
                      key={step.index}
                      data-current={
                        intent.status !== 'finished' &&
                        step.index === intent.step &&
                        !doneSteps.has(step.index)
                      }
                      data-done={doneSteps.has(step.index)}
                      data-next={
                        nextStep?.index === step.index &&
                        !doneSteps.has(step.index)
                      }
                    >
                      <span className="hud-step-index">{step.index}.</span>
                      <span className="hud-step-main">
                        <span className="hud-step-title">{step.title}</span>
                        {((stepByStep &&
                          canRunNext &&
                          nextStep?.index === step.index) ||
                          (canComplete && step.index === intent.step)) && (
                          <button
                            className="hud-button hud-button-approve hud-run-step"
                            type="button"
                            onClick={() =>
                              canComplete && step.index === intent.step
                                ? act('continue')
                                : act('invoke', {
                                    step: step.index,
                                  })
                            }
                          >
                            {canComplete && step.index === intent.step
                              ? 'Complete'
                              : 'Run step'}
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
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
                      Added islands
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
                <div className="hud-decide">
                  <button
                    className="hud-button hud-button-reject"
                    type="button"
                    onClick={() => act('stop')}
                  >
                    Stop
                  </button>
                </div>
              )}
              {pending && (
                <>
                  <label className="hud-instruction">
                    <span>Alternative instruction for the LLM</span>
                    <textarea
                      value={instruction}
                      maxLength={4000}
                      rows={3}
                      placeholder="Describe what should change in the next diff…"
                      onChange={(event) => setInstruction(event.target.value)}
                    />
                  </label>
                  <div className="hud-decide">
                    {lastStep && (
                      <button
                        className="hud-button hud-button-approve"
                        type="button"
                        onClick={() => act('continue')}
                      >
                        Complete
                      </button>
                    )}
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
                </>
              )}
            </>
          )}
        </>
      )}
    </aside>
  )
}

type HUDProps = {
  graph: CodebaseGraph
  layout: WorldLayout
  mode: ViewMode
  locked: boolean
  selectedId: string | null
  selectedTick?: number
  inspectTick?: number
  selectedFolder?: string | null
  landAt: [number, number]
  aimedRelation: AimedRelation | null
  aimedFileId?: string | null
  currentFolder: string
  intent: AgentIntent
  intents?: AgentIntent[]
  focusedSessionId?: string | null
  onFocusSession?: (sessionId: string) => void
  onWorkflowAction: (
    sessionId: string,
    action: WorkflowAction,
    options?: { instruction?: string; step?: number; stepByStep?: boolean },
  ) => void
  onNavigateDiff: (sessionId: string, diffId: string) => void
  onOpenMap: () => void
  onWalk: () => void
  followLook: boolean
  onToggleFollowLook: () => void
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
  onAddBlueprintFunction?: (fileId: string, name: string) => boolean
  onAddBlueprintVariable?: (fileId: string, name: string) => boolean
  onAddBlueprintImport?: (fileId: string, raw: string) => boolean
  onRemoveBlueprintFunction?: (fileId: string, name: string) => void
  onRemoveBlueprintVariable?: (fileId: string, name: string) => void
  onRemoveBlueprintImport?: (
    fileId: string,
    name: string,
    from: string,
  ) => void
  onMapAddFile?: (folderPath: string) => void
  onMapAddFolder?: (folderPath: string) => void
  onInspectFile?: (fileId: string) => void
  onInspectBlock?: (fileId: string) => void
  plannedIds?: string[]
  createdIds?: string[]
  deletedIds?: string[]
}

export function HUD({
  graph,
  layout,
  mode,
  locked,
  selectedId,
  selectedTick = 0,
  inspectTick = 0,
  selectedFolder = null,
  landAt,
  aimedRelation,
  aimedFileId = null,
  currentFolder,
  intent,
  intents,
  focusedSessionId = null,
  onFocusSession,
  onWorkflowAction,
  onNavigateDiff,
  onOpenMap,
  onWalk,
  followLook,
  onToggleFollowLook,
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
  onAddBlueprintFunction,
  onAddBlueprintVariable,
  onAddBlueprintImport,
  onRemoveBlueprintFunction,
  onRemoveBlueprintVariable,
  onRemoveBlueprintImport,
  onMapAddFile,
  onMapAddFolder,
  onInspectFile,
  onInspectBlock,
  plannedIds = [],
  createdIds = [],
  deletedIds = [],
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
  const canStop = canStopSession(intent)
  const [walkIntro, setWalkIntro] = useState(false)
  const walkIntroSeen = useRef(false)
  const [infoVisible, setInfoVisible] = useState(false)
  const [infoMinimized, setInfoMinimized] = useState(false)
  const [thumbnailVisible, setThumbnailVisible] = useState(true)
  const [thumbnailMinimized, setThumbnailMinimized] = useState(false)
  const [thumbnailMaximized, setThumbnailMaximized] = useState(false)
  const infoPanelRef = useRef<HTMLDivElement>(null)
  const creatingBlueprint = sessions.some(
    (item) => item.creationMode || item.status === 'blueprint',
  )
  const previewing = intent.preview
  const addedFunctions = intent.addedFunctions ?? []
  const addedVariables = intent.addedVariables ?? []
  const addedImports = intent.addedImports ?? []
  const changedFunctions = intent.changedFunctions ?? []
  const changedVariables = intent.changedVariables ?? []
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
    creatingBlueprint && Boolean(selected) && !selected?.id.startsWith('draft:')
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

  const infoOpen = infoVisible && Boolean(selected || selectedFolderNode)

  useEffect(() => {
    if (infoOpen) document.exitPointerLock()
  }, [infoOpen])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'KeyI') return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'TEXTAREA' ||
          target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
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
    if (!mapping) return
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'KeyT') return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'TEXTAREA' ||
          target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      setThumbnailVisible((visible) => {
        if (!visible) {
          setThumbnailMinimized(false)
          setThumbnailMaximized(false)
        } else {
          setThumbnailMaximized(false)
        }
        return !visible
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mapping])

  useEffect(() => {
    if (!infoVisible || (!selectedId && !selectedFolder)) return
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'ArrowUp' && event.code !== 'ArrowDown') return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'TEXTAREA' ||
          target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
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
              <kbd>Shift</kbd> sprint
              {creatingBlueprint ? (
                <>
                  , <kbd>Space</kbd> place a file, <kbd>B</kbd> place an island
                </>
              ) : null}
              , double-click a block or press <kbd>I</kbd> for info.
            </p>
          </div>
        </div>
      )}

      {namingIsland && onCommitIslandName && onCancelIslandName && (
        <div className="hud-name-gate">
          <NameInput
            placeholder="Folder name"
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
        <div className="hud-chip">
          {mapping ? `Map of ${graph.targetName}` : `You are in ${currentFolder}`}
        </div>
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
          {canStop && (
            <button
              className="hud-button hud-button-reject"
              type="button"
              aria-label="Stop LLM session"
              onClick={() =>
                intent.sessionId && onWorkflowAction(intent.sessionId, 'stop')
              }
            >
              Stop
            </button>
          )}
        </div>
        {selected && <div className="hud-chip">{selected.path}</div>}
      </div>

      {sessions.length > 0 && (
        <div className="hud-left-stack">
          {sessions.map((session) => (
            <SessionPanel
              key={session.sessionId}
              intent={session}
              focused={session.sessionId === (focusedSessionId ?? intent.sessionId)}
              naming={naming}
              onFocus={() => {
                if (session.sessionId) onFocusSession?.(session.sessionId)
              }}
              onWorkflowAction={onWorkflowAction}
              onNavigateDiff={onNavigateDiff}
            />
          ))}
        </div>
      )}

      <div className="hud-right-stack">
      {selected && infoVisible && (
        <aside
          className="hud-panel hud-panel-info"
          data-minimized={infoMinimized}
        >
          <PanelChrome
            title={selected.name}
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
          {canInspectFile(selected.id, selected.userCreated) && (
            <button
              className="hud-button hud-inspect"
              type="button"
              onClick={() => onInspectFile?.(selected.id)}
            >
              Inspect file
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
                  LLM changes
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
                <li key={`fn-${symbol.name}`}>
                  <span
                    className={
                      symbolChangeClass(functionChange.get(symbol.name)) ??
                      (symbol.intended ? 'hud-intended' : undefined)
                    }
                  >
                    {symbol.name}
                  </span>
                  {canEditBlueprint && symbol.intended && (
                    <button
                      className="hud-item-remove"
                      type="button"
                      aria-label={`Remove ${symbol.name}`}
                      onClick={() =>
                        onRemoveBlueprintFunction?.(selected.id, symbol.name)
                      }
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
              {extraAddedFunctions.map((item) => (
                <li key={`fn-add-${item.name}`}>
                  <span className="hud-file-add">{item.name}</span>
                </li>
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
                <li key={`var-${symbol.name}`}>
                  <span
                    className={
                      symbolChangeClass(variableChange.get(symbol.name)) ??
                      (symbol.intended ? 'hud-intended' : undefined)
                    }
                  >
                    {symbol.name}
                  </span>
                  {canEditBlueprint && symbol.intended && (
                    <button
                      className="hud-item-remove"
                      type="button"
                      aria-label={`Remove ${symbol.name}`}
                      onClick={() =>
                        onRemoveBlueprintVariable?.(selected.id, symbol.name)
                      }
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
              {extraAddedVariables.map((item) => (
                <li key={`var-add-${item.name}`}>
                  <span className="hud-file-add">{item.name}</span>
                </li>
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
                  <li key={file.id}>{file.id}</li>
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
                  >
                    {id}
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
                  <span className="hud-intended">
                    {item.name === item.from
                      ? item.from
                      : `${item.name} from ${item.from}`}
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
            <AddIntentRow
              placeholder="Clock from src/components/Clock.tsx"
              onAdd={(raw) => onAddBlueprintImport(selected.id, raw)}
            />
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
            <p>No files on this island</p>
          ) : (
            <ul>
              {folderFiles.map((file) => (
                <li key={file.id}>
                  <span>{file.name}</span>
                  {canInspectFile(file.id, file.userCreated) && (
                    <button
                      className="hud-item-inspect"
                      type="button"
                      onClick={() => onInspectFile?.(file.id)}
                    >
                      Inspect
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {creatingBlueprint && mapping && onMapAddFile && onMapAddFolder && (
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

      {mapping && thumbnailVisible && (
        <SelectionThumbnail
          graph={graph}
          layout={layout}
          selectedId={selectedId}
          selectedFolder={selectedFolder}
          landAt={landAt}
          importedBy={importedBy}
          minimized={thumbnailMinimized}
          maximized={thumbnailMaximized}
          plannedIds={plannedIds}
          createdIds={createdIds}
          deletedIds={deletedIds}
          onMinimize={() => {
            setThumbnailMaximized(false)
            setThumbnailMinimized((current) => !current)
          }}
          onMaximize={() => {
            setThumbnailMinimized(false)
            setThumbnailMaximized((current) => !current)
          }}
          onHide={() => {
            setThumbnailVisible(false)
            setThumbnailMinimized(false)
            setThumbnailMaximized(false)
          }}
        />
      )}
      </div>

      <div className="hud-bottom">
        <div className="hud-hints">
          {mapping ? (
            <>
              <span>Scroll zoom</span>
              <span>Drag pan</span>
              <span>Click a block for info</span>
              <span>Click an island for its files</span>
              {creatingBlueprint && (
                <>
                  <span>Select an island</span>
                  <span>Add file / Add folder in panel</span>
                </>
              )}
              <span>Click a line to fly there</span>
              <span>Ctrl-click an island to walk</span>
              <span>Gold pin is your walk position</span>
              {hasChangeSet && (
                <span>
                  {changePathsOnly
                    ? 'C show all paths'
                    : 'C show only changed paths'}
                </span>
              )}
              {selected?.userCreated && creatingBlueprint && (
                <span>Backspace delete</span>
              )}
              <span>{infoVisible ? 'I hide info' : 'I show info'}</span>
              {infoVisible && <span>↑↓ scroll info</span>}
              <span>
                {thumbnailVisible ? 'T hide 3D view' : 'T show 3D view'}
              </span>
              <span>
                {importedBy ? 'K show imports' : 'K show imported by'}
              </span>
              <span>M back to walk</span>
              {canStop && (
                <span>
                  {sessions.length > 1
                    ? 'Stop ends the focused LLM session'
                    : 'Stop ends this LLM session'}
                </span>
              )}
            </>
          ) : (
            <>
              <span>WASD walk</span>
              <span>Mouse look</span>
              <span>Shift sprint</span>
              {creatingBlueprint && (
                <>
                  <span>Space place file</span>
                  <span>B place island</span>
                </>
              )}
              {selected?.userCreated && creatingBlueprint && (
                <span>Backspace delete</span>
              )}
              <span>Double-click a block for info</span>
              <span>Aim a line to fly</span>
              <span>{infoVisible ? 'I hide info' : 'I show info'}</span>
              {infoVisible && <span>↑↓ scroll info</span>}
              <span>
                {importedBy ? 'K show imports' : 'K show imported by'}
              </span>
              <span>M toggle map</span>
              <span>Double-click or Esc release mouse</span>
              {canStop && (
                <span>
                  {sessions.length > 1
                    ? 'Stop ends the focused LLM session'
                    : 'Stop ends this LLM session'}
                </span>
              )}
            </>
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
          {mapping && (
            <button
              className="hud-button hud-icon-button"
              data-active={thumbnailVisible}
              aria-label={
                thumbnailVisible ? 'Hide 3D view' : 'Show 3D view'
              }
              aria-keyshortcuts="T"
              aria-pressed={thumbnailVisible}
              type="button"
              onClick={() => {
                setThumbnailVisible((visible) => {
                  if (!visible) {
                    setThumbnailMinimized(false)
                    setThumbnailMaximized(false)
                  } else {
                    setThumbnailMaximized(false)
                  }
                  return !visible
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
                <rect x="3" y="5" width="11" height="14" rx="1.5" />
                <path d="M16 8h5v11H9v-3" />
                <path d="M6.5 16.5 9 12l2 2.5 1.5-2L15 16.5" />
              </svg>
              <span className="hud-tooltip">
                {thumbnailVisible ? 'T hide 3D view' : 'T show 3D view'}
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
            data-active={followLook}
            aria-label="Make LLM look where I look"
            aria-pressed={followLook}
            type="button"
            onClick={onToggleFollowLook}
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
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span className="hud-tooltip">Make LLM look where I look</span>
          </button>
        </div>
      </div>
    </div>
  )
}
