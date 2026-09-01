import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { shouldIgnoreShortcut, isKeyboardIsolated } from './keyboard'
import { emptyIntent, fetchAgentIntent, fetchAgentIntents, inspectTargetFile, performAgentAction, persistBlueprintCleanup, persistBlueprintClear, persistBlueprintHidden, persistSessionBlueprint, persistSessionFocus } from './agentIntent'
import { emptyBranchChanges, fetchBranchChanges } from './branchChanges'
import { fetchCodebase, updateCodebase } from './codebase'
import {
  emptyDevTargets,
  fetchDevTargets,
  selectDevTarget,
  type DevTargetsState,
} from './devTargets'
import {
  layoutWorld,
  markCreatedFolders,
  standInFront,
  relationTravelTarget,
  withPreviewGraph,
  filterGraphToChangePaths,
  mapPointOntoFolder,
  regionBounds,
} from './layout'
import { World } from './scene/World'
import { HUD } from './ui/HUD'
import { ExplainAskCard } from './ui/ExplainAskCard'
import { ExplainHud } from './ui/ExplainHud'
import { ExplainInfoPanel } from './ui/ExplainInfoPanel'
import { ExplainPointer } from './ui/ExplainPointer'
import { CanvasErrorBoundary } from './ui/CanvasErrorBoundary'
import {
  MapContextMenu,
  type MapContextMenuState,
} from './ui/MapContextMenu'
import {
  currentExplainStep,
  emptyExplain,
  explainFocus,
  explainInfoFile,
  explainIsCard,
  explainTargetQuestion,
  fetchExplain,
  mergeExplainPoll,
  persistExplainStart,
  persistExplainStep,
  persistExplainStop,
} from './explain'
import {
  fetchUserContext,
  persistShowBranchChanges,
  persistUserContext,
} from './userContext'
import {
  createdIslandKey,
  createdItemsInsideFolder,
  defaultBlockSpot,
  dropBlueprintFileNotes,
  dropBlueprintSymbolNote,
  dropBlueprintSymbolPointer,
  findBlueprintPointer,
  isBlueprintSymbolName,
  namedCreatedBlocks,
  namedCreatedIslands,
  omitCreatedItems,
  blueprintImportRawFromFile,
  parseBlueprintImport,
  parseBlueprintNotes,
  parseBlueprintPointers,
  parseUserCreatedBlocks,
  parseUserCreatedIslands,
  remapBlueprintFileId,
  resolveCreatedFile,
  resolveCreatedIsland,
  setBlueprintNote,
  toggleBlueprintPointer,
  withBlueprintIntent,
  withUserCreatedGraph,
  layoutBlueprintLayers,
  mergeOverlayOnlyFolders,
} from './userCreated'
import {
  isPatchPreview,
  isReviewingIntent,
  llmIsMakingChanges,
  type AgentIntent,
  type AimedRelation,
  type BlueprintNote,
  type BlueprintNoteKind,
  type BlueprintOption,
  type BlueprintPointer,
  type BlueprintPointerKind,
  type CodebaseGraph,
  type ExplainSession,
  type ExplainTargetKind,
  type FlyTo,
  GLOBAL_BLUEPRINT_COLOR,
  type LocalBlueprint,
  type PatchImportAddition,
  type PatchSymbolAddition,
  type SharedBlueprint,
  type UserCreatedBlock,
  type UserCreatedIsland,
  type ViewMode,
  type RelationMode,
  type WorkflowAction,
  type WorldLayout,
} from './types'
import { BLUEPRINT_OVERLAY } from './theme'

function emptySharedBlueprint(): SharedBlueprint {
  return {
    hidden: false,
    revision: 0,
    enabled: false,
    userCreatedBlocks: [],
    userCreatedIslands: [],
    addedFunctions: [],
    addedVariables: [],
    addedImports: [],
    notes: [],
    pointers: [],
  }
}

function blueprintForColor(
  color: string,
  global: SharedBlueprint,
  locals: LocalBlueprint[],
) {
  if (color === GLOBAL_BLUEPRINT_COLOR.id) return global
  return locals.find((item) => item.color === color) ?? emptySharedBlueprint()
}

function blueprintOptionsFrom(
  intents: AgentIntent[],
  locals: LocalBlueprint[],
): BlueprintOption[] {
  const byColor = new Map<string, BlueprintOption>()
  for (const intent of intents) {
    if (!intent.color || byColor.has(intent.color)) continue
    byColor.set(intent.color, {
      id: intent.color,
      name: intent.colorName || intent.color,
      hex: intent.colorHex || '#6b7280',
      kind: 'local',
      sessionId: intent.sessionId,
    })
  }
  for (const local of locals) {
    const existing = byColor.get(local.color)
    byColor.set(local.color, {
      id: local.color,
      name: local.colorName || existing?.name || local.color,
      hex: local.colorHex || existing?.hex || '#6b7280',
      kind: 'local',
      sessionId: local.sessionId,
    })
  }
  return [
    {
      id: GLOBAL_BLUEPRINT_COLOR.id,
      name: GLOBAL_BLUEPRINT_COLOR.name,
      hex: GLOBAL_BLUEPRINT_COLOR.hex,
      kind: 'global',
      sessionId: null,
    },
    ...byColor.values(),
  ]
}

function blueprintLiveEnabled(
  blocks: UserCreatedBlock[],
  islands: UserCreatedIsland[],
  functions: PatchSymbolAddition[],
  variables: PatchSymbolAddition[],
  imports: PatchImportAddition[],
  notes: BlueprintNote[],
  pointers: BlueprintPointer[],
) {
  return (
    namedCreatedBlocks(blocks).length > 0 ||
    namedCreatedIslands(islands).length > 0 ||
    functions.length > 0 ||
    variables.length > 0 ||
    imports.length > 0 ||
    notes.length > 0 ||
    pointers.length > 0
  )
}

function keepBlueprintDrafts(
  stored: SharedBlueprint,
  previous?: SharedBlueprint | null,
): SharedBlueprint {
  if (!previous) return stored
  const draftBlocks = previous.userCreatedBlocks.filter((block) => block.naming)
  const draftIslands = previous.userCreatedIslands.filter((island) => island.naming)
  if (draftBlocks.length === 0 && draftIslands.length === 0) return stored
  const draftBlockIds = new Set(draftBlocks.map((block) => block.id))
  const draftIslandIds = new Set(draftIslands.map((island) => island.id))
  return {
    ...stored,
    userCreatedBlocks: [
      ...stored.userCreatedBlocks.filter((block) => !draftBlockIds.has(block.id)),
      ...draftBlocks,
    ],
    userCreatedIslands: [
      ...stored.userCreatedIslands.filter(
        (island) => !draftIslandIds.has(island.id),
      ),
      ...draftIslands,
    ],
  }
}

function capturedBlueprintContents(
  current: SharedBlueprint,
  capture: {
    hidden: boolean
    blocks: UserCreatedBlock[]
    islands: UserCreatedIsland[]
    functions: PatchSymbolAddition[]
    variables: PatchSymbolAddition[]
    imports: PatchImportAddition[]
    notes: BlueprintNote[]
    pointers: BlueprintPointer[]
  },
): SharedBlueprint {
  return {
    ...current,
    hidden: capture.hidden,
    enabled: blueprintLiveEnabled(
      capture.blocks,
      capture.islands,
      capture.functions,
      capture.variables,
      capture.imports,
      capture.notes,
      capture.pointers,
    ),
    userCreatedBlocks: capture.blocks,
    userCreatedIslands: capture.islands,
    addedFunctions: capture.functions,
    addedVariables: capture.variables,
    addedImports: capture.imports,
    notes: capture.notes,
    pointers: capture.pointers,
  }
}

function withCapturedBlueprint(
  current: { global: SharedBlueprint; locals: LocalBlueprint[] },
  capture: {
    color: string
    hidden: boolean
    blocks: UserCreatedBlock[]
    islands: UserCreatedIsland[]
    functions: PatchSymbolAddition[]
    variables: PatchSymbolAddition[]
    imports: PatchImportAddition[]
    notes: BlueprintNote[]
    pointers: BlueprintPointer[]
    options: BlueprintOption[]
  },
): { global: SharedBlueprint; locals: LocalBlueprint[] } {
  const fields = {
    hidden: capture.hidden,
    blocks: capture.blocks,
    islands: capture.islands,
    functions: capture.functions,
    variables: capture.variables,
    imports: capture.imports,
    notes: capture.notes,
    pointers: capture.pointers,
  }
  if (capture.color === GLOBAL_BLUEPRINT_COLOR.id) {
    return {
      global: capturedBlueprintContents(current.global, fields),
      locals: current.locals,
    }
  }
  const existing = current.locals.find((item) => item.color === capture.color)
  const option = capture.options.find((item) => item.id === capture.color)
  const nextLocal: LocalBlueprint = {
    color: capture.color,
    colorName: existing?.colorName || option?.name || capture.color,
    colorHex: existing?.colorHex || option?.hex || '#6b7280',
    sessionId: existing?.sessionId || option?.sessionId || '',
    ...capturedBlueprintContents(existing ?? emptySharedBlueprint(), fields),
  }
  const locals = existing
    ? current.locals.map((item) =>
        item.color === capture.color ? nextLocal : item,
      )
    : [...current.locals, nextLocal]
  return { global: current.global, locals }
}

function withPolledBlueprints(
  previous: { global: SharedBlueprint; locals: LocalBlueprint[] },
  polled: { global: SharedBlueprint; locals: LocalBlueprint[] },
): { global: SharedBlueprint; locals: LocalBlueprint[] } {
  return {
    global: keepBlueprintDrafts(polled.global, previous.global),
    locals: polled.locals.map((local) => {
      const prior = previous.locals.find((item) => item.color === local.color)
      const merged = keepBlueprintDrafts(local, prior)
      return {
        ...local,
        ...merged,
        color: local.color,
        colorName: local.colorName,
        colorHex: local.colorHex,
        sessionId: local.sessionId,
      }
    }),
  }
}

function visibleItemsForBlueprint(
  hidden: boolean,
  blocks: UserCreatedBlock[],
  islands: UserCreatedIsland[],
) {
  if (!hidden) return { blocks, islands }
  return {
    blocks: blocks.filter((block) => block.naming),
    islands: islands.filter((island) => island.naming),
  }
}

function withBlueprintHidden(
  current: { global: SharedBlueprint; locals: LocalBlueprint[] },
  color: string,
  hidden: boolean,
  options: BlueprintOption[],
): { global: SharedBlueprint; locals: LocalBlueprint[] } {
  if (color === GLOBAL_BLUEPRINT_COLOR.id) {
    return {
      global: { ...current.global, hidden },
      locals: current.locals,
    }
  }
  const existing = current.locals.find((item) => item.color === color)
  if (existing) {
    return {
      global: current.global,
      locals: current.locals.map((item) =>
        item.color === color ? { ...item, hidden } : item,
      ),
    }
  }
  const option = options.find((item) => item.id === color)
  return {
    global: current.global,
    locals: [
      ...current.locals,
      {
        color,
        colorName: option?.name || color,
        colorHex: option?.hex || '#6b7280',
        sessionId: option?.sessionId || '',
        ...emptySharedBlueprint(),
        hidden,
      },
    ],
  }
}

function emptiedBlueprint<T extends SharedBlueprint>(current: T): T {
  return {
    ...current,
    enabled: false,
    userCreatedBlocks: [],
    userCreatedIslands: [],
    addedFunctions: [],
    addedVariables: [],
    addedImports: [],
    notes: [],
    pointers: [],
  }
}

function cleanedBlueprint<T extends SharedBlueprint>(
  current: T,
  files: Set<string>,
  folders: Set<string>,
): T {
  const nextBlocks = current.userCreatedBlocks.filter(
    (block) => block.naming || !files.has(block.id),
  )
  const nextIslands = current.userCreatedIslands.filter(
    (island) => island.naming || !folders.has(island.path),
  )
  const removed = new Set(
    current.userCreatedBlocks
      .filter((block) => !block.naming && files.has(block.id))
      .map((block) => block.id),
  )
  const nextFunctions = current.addedFunctions.filter(
    (item) => !removed.has(item.file),
  )
  const nextVariables = current.addedVariables.filter(
    (item) => !removed.has(item.file),
  )
  const nextImports = current.addedImports.filter(
    (item) => !removed.has(item.file),
  )
  const notes = dropBlueprintFileNotes(current.notes, removed)
  return {
    ...current,
    enabled: blueprintLiveEnabled(
      nextBlocks,
      nextIslands,
      nextFunctions,
      nextVariables,
      nextImports,
      notes,
      current.pointers,
    ),
    userCreatedBlocks: nextBlocks,
    userCreatedIslands: nextIslands,
    addedFunctions: nextFunctions,
    addedVariables: nextVariables,
    addedImports: nextImports,
    notes,
  }
}

function withPatchedBlueprint(
  current: { global: SharedBlueprint; locals: LocalBlueprint[] },
  color: string,
  patch: (blueprint: SharedBlueprint) => SharedBlueprint,
): { global: SharedBlueprint; locals: LocalBlueprint[] } {
  if (color === GLOBAL_BLUEPRINT_COLOR.id) {
    return { global: patch(current.global), locals: current.locals }
  }
  return {
    global: current.global,
    locals: current.locals.map((item) =>
      item.color === color ? { ...item, ...patch(item) } : item,
    ),
  }
}

function collectMapBlueprints(input: {
  selectedColor: string
  visibleColors: ReadonlySet<string>
  selectedBlocks: UserCreatedBlock[]
  selectedIslands: UserCreatedIsland[]
  selectedFunctions: PatchSymbolAddition[]
  selectedVariables: PatchSymbolAddition[]
  selectedImports: PatchImportAddition[]
  selectedPointers: BlueprintPointer[]
  global: SharedBlueprint
  locals: LocalBlueprint[]
}) {
  const blocks = new Map<string, UserCreatedBlock>()
  const islands = new Map<string, UserCreatedIsland>()
  const functions: PatchSymbolAddition[] = []
  const variables: PatchSymbolAddition[] = []
  const imports: PatchImportAddition[] = []
  const pointers: Array<BlueprintPointer & { colorHex: string }> = []

  const sources: Array<{
    id: string
    hex: string
    hidden: boolean
    live: boolean
    blocks: UserCreatedBlock[]
    islands: UserCreatedIsland[]
    functions: PatchSymbolAddition[]
    variables: PatchSymbolAddition[]
    imports: PatchImportAddition[]
    pointers: BlueprintPointer[]
  }> = [
    {
      id: GLOBAL_BLUEPRINT_COLOR.id,
      hex: GLOBAL_BLUEPRINT_COLOR.hex,
      hidden: !input.visibleColors.has(GLOBAL_BLUEPRINT_COLOR.id),
      live: input.selectedColor === GLOBAL_BLUEPRINT_COLOR.id,
      blocks:
        input.selectedColor === GLOBAL_BLUEPRINT_COLOR.id
          ? input.selectedBlocks
          : input.global.userCreatedBlocks,
      islands:
        input.selectedColor === GLOBAL_BLUEPRINT_COLOR.id
          ? input.selectedIslands
          : input.global.userCreatedIslands,
      functions:
        input.selectedColor === GLOBAL_BLUEPRINT_COLOR.id
          ? input.selectedFunctions
          : input.global.addedFunctions,
      variables:
        input.selectedColor === GLOBAL_BLUEPRINT_COLOR.id
          ? input.selectedVariables
          : input.global.addedVariables,
      imports:
        input.selectedColor === GLOBAL_BLUEPRINT_COLOR.id
          ? input.selectedImports
          : input.global.addedImports,
      pointers:
        input.selectedColor === GLOBAL_BLUEPRINT_COLOR.id
          ? input.selectedPointers
          : input.global.pointers,
    },
    ...input.locals.map((local) => ({
      id: local.color,
      hex: local.colorHex || GLOBAL_BLUEPRINT_COLOR.hex,
      hidden: !input.visibleColors.has(local.color),
      live: input.selectedColor === local.color,
      blocks:
        input.selectedColor === local.color
          ? input.selectedBlocks
          : local.userCreatedBlocks,
      islands:
        input.selectedColor === local.color
          ? input.selectedIslands
          : local.userCreatedIslands,
      functions:
        input.selectedColor === local.color
          ? input.selectedFunctions
          : local.addedFunctions,
      variables:
        input.selectedColor === local.color
          ? input.selectedVariables
          : local.addedVariables,
      imports:
        input.selectedColor === local.color
          ? input.selectedImports
          : local.addedImports,
      pointers:
        input.selectedColor === local.color
          ? input.selectedPointers
          : local.pointers,
    })),
  ]

  sources.sort((left, right) => Number(left.live) - Number(right.live))
  const layers: Array<{
    id: string
    hex: string
    blocks: UserCreatedBlock[]
    islands: UserCreatedIsland[]
  }> = []
  for (const source of sources) {
    const visible = visibleItemsForBlueprint(
      source.hidden,
      source.blocks,
      source.islands,
    )
    layers.push({
      id: source.id,
      hex: source.hex,
      blocks: visible.blocks.map((block) => ({
        ...block,
        colorHex: source.hex,
      })),
      islands: visible.islands.map((island) => ({
        ...island,
        colorHex: source.hex,
      })),
    })
    for (const block of visible.blocks) {
      blocks.set(block.id, { ...block, colorHex: source.hex })
    }
    for (const island of visible.islands) {
      islands.set(island.id, { ...island, colorHex: source.hex })
    }
    if (!source.hidden) {
      functions.push(...source.functions)
      variables.push(...source.variables)
      imports.push(...source.imports)
      for (const pointer of source.pointers) {
        pointers.push({ ...pointer, colorHex: source.hex })
      }
    }
  }

  return {
    blocks: [...blocks.values()],
    islands: [...islands.values()],
    layers,
    functions,
    variables,
    imports,
    pointers,
  }
}

function pointerColorMaps(
  pointers: Array<BlueprintPointer & { colorHex?: string }>,
) {
  const files: Record<string, string[]> = {}
  const folders: Record<string, string[]> = {}
  for (const item of pointers) {
    const hex = item.colorHex || GLOBAL_BLUEPRINT_COLOR.hex
    const target = item.kind === 'folder' ? folders : files
    const list = target[item.path] ?? []
    if (!list.includes(hex)) list.push(hex)
    target[item.path] = list
  }
  return { files, folders }
}

function intentSignature(intent: AgentIntent) {
  return JSON.stringify({
    updatedAt: intent.updatedAt,
    status: intent.status,
    phase: intent.phase,
    stalledWait: intent.stalledWait,
    llmIdle: intent.llmIdle,
    awaitingAttach: intent.awaitingAttach,
    listening: intent.listening,
    lastAck: intent.lastAck,
    sessionId: intent.sessionId,
    name: intent.name,
    feature: intent.feature,
    creationMode: intent.creationMode,
    diffId: intent.diffId,
    chain: intent.chain,
    files: intent.files,
    creates: intent.creates,
    deletes: intent.deletes,
    createFolders: intent.createFolders,
    imports: intent.imports,
    addedFunctions: intent.addedFunctions,
    addedVariables: intent.addedVariables,
    addedImports: intent.addedImports,
    changedFunctions: intent.changedFunctions,
    changedVariables: intent.changedVariables,
  })
}

export default function App() {
  const [graph, setGraph] = useState<CodebaseGraph | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [updatingModel, setUpdatingModel] = useState(false)
  const updatingModelRef = useRef(false)
  const [devTargets, setDevTargets] = useState<DevTargetsState>(emptyDevTargets)
  const [targetEpoch, setTargetEpoch] = useState(0)

  const graphSig = useRef<string | null>(null)
  const applyGraph = useCallback((next: CodebaseGraph | null, failed: string) => {
    if (next) {
      const signature = JSON.stringify(next)
      if (signature === graphSig.current) {
        setLoadError(null)
        return true
      }
      graphSig.current = signature
      setGraph(next)
      setLoadError(null)
      return true
    }
    setLoadError((current) => current ?? failed)
    return false
  }, [])

  const refreshGraph = useCallback(async () => {
    applyGraph(await fetchCodebase(), 'Could not load files and folders.')
  }, [applyGraph])

  const updateModel = useCallback(async () => {
    if (updatingModelRef.current) return
    updatingModelRef.current = true
    setUpdatingModel(true)
    try {
      applyGraph(await updateCodebase(), 'Could not update files and folders.')
    } finally {
      updatingModelRef.current = false
      setUpdatingModel(false)
    }
  }, [applyGraph])

  const switchDevTarget = useCallback(
    async (id: string) => {
      if (updatingModelRef.current) return
      updatingModelRef.current = true
      setUpdatingModel(true)
      try {
        const result = await selectDevTarget(id)
        if (!result?.graph) {
          setLoadError((current) => current ?? 'Could not switch project.')
          return
        }
        setDevTargets(result.state)
        applyGraph(result.graph, 'Could not switch project.')
        setTargetEpoch((value) => value + 1)
      } finally {
        updatingModelRef.current = false
        setUpdatingModel(false)
      }
    },
    [applyGraph],
  )

  useEffect(() => {
    void refreshGraph()
  }, [refreshGraph])

  useEffect(() => {
    void fetchDevTargets().then(setDevTargets)
  }, [])

  if (!graph) {
    return (
      <div className="boot">
        <p>{loadError ?? 'Loading files and folders…'}</p>
      </div>
    )
  }

  return (
    <Explorer
      key={targetEpoch}
      graph={graph}
      onRefreshGraph={refreshGraph}
      onUpdateModel={updateModel}
      updatingModel={updatingModel}
      devTargets={devTargets}
      onSelectDevTarget={switchDevTarget}
    />
  )
}

function Explorer({
  graph,
  onRefreshGraph,
  onUpdateModel,
  updatingModel,
  devTargets,
  onSelectDevTarget,
}: {
  graph: CodebaseGraph
  onRefreshGraph: () => Promise<void>
  onUpdateModel: () => Promise<void>
  updatingModel: boolean
  devTargets: DevTargetsState
  onSelectDevTarget: (id: string) => void
}) {
  const [intents, setIntents] = useState<AgentIntent[]>([])
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null)
  const [nextAttachSessionId, setNextAttachSessionId] = useState<string | null>(
    null,
  )
  const [wantBranchChanges, setWantBranchChanges] = useState(false)
  const [branchChanges, setBranchChanges] = useState(emptyBranchChanges)
  const intent =
    intents.find((item) => item.sessionId === focusedSessionId) ??
    intents[0] ??
    emptyIntent
  const canPlace = true
  const llmBusy = intents.some(llmIsMakingChanges)
  const llmPreviewing = intent.preview || isPatchPreview(intent.status)
  const showingBranchChanges =
    wantBranchChanges &&
    !llmBusy &&
    !llmPreviewing &&
    branchChanges.available
  const changeSet = llmPreviewing
    ? intent
    : showingBranchChanges
      ? branchChanges
      : emptyIntent
  const previewing = llmPreviewing || showingBranchChanges
  const plannedCreates = previewing ? changeSet.creates : []
  const [userBlocks, setUserBlocks] = useState<UserCreatedBlock[]>([])
  const [userIslands, setUserIslands] = useState<UserCreatedIsland[]>([])
  const [blueprintFunctions, setBlueprintFunctions] = useState<
    PatchSymbolAddition[]
  >([])
  const [blueprintVariables, setBlueprintVariables] = useState<
    PatchSymbolAddition[]
  >([])
  const [blueprintImports, setBlueprintImports] = useState<
    PatchImportAddition[]
  >([])
  const [blueprintNotes, setBlueprintNotes] = useState<BlueprintNote[]>([])
  const [blueprintPointers, setBlueprintPointers] = useState<BlueprintPointer[]>(
    [],
  )
  const [blueprintHidden, setBlueprintHidden] = useState(false)
  const [blueprintOpacity, setBlueprintOpacity] = useState(
    BLUEPRINT_OVERLAY.strength,
  )
  const [blueprintColor, setBlueprintColor] = useState<string>(
    GLOBAL_BLUEPRINT_COLOR.id,
  )
  const [visibleBlueprintColors, setVisibleBlueprintColors] = useState<string[]>(
    [GLOBAL_BLUEPRINT_COLOR.id],
  )
  const [globalBlueprint, setGlobalBlueprint] = useState<SharedBlueprint>(
    emptySharedBlueprint,
  )
  const [localBlueprints, setLocalBlueprints] = useState<LocalBlueprint[]>([])
  const blueprintColorRef = useRef(blueprintColor)
  blueprintColorRef.current = blueprintColor
  const blueprintHiddenRef = useRef(blueprintHidden)
  blueprintHiddenRef.current = blueprintHidden
  const visibleBlueprintColorsRef = useRef(visibleBlueprintColors)
  visibleBlueprintColorsRef.current = visibleBlueprintColors
  const latestBlueprintsRef = useRef({
    global: emptySharedBlueprint(),
    locals: [] as LocalBlueprint[],
  })
  const blueprintOptionsRef = useRef<BlueprintOption[]>([])
  blueprintOptionsRef.current = blueprintOptionsFrom(intents, localBlueprints)
  const placementLayoutRef = useRef<WorldLayout | null>(null)
  const userBlocksRef = useRef(userBlocks)
  const userIslandsRef = useRef(userIslands)
  const blueprintFunctionsRef = useRef(blueprintFunctions)
  const blueprintVariablesRef = useRef(blueprintVariables)
  const blueprintImportsRef = useRef(blueprintImports)
  const blueprintNotesRef = useRef(blueprintNotes)
  const blueprintPointersRef = useRef(blueprintPointers)
  const persistBlueprintRef = useRef<() => void>(() => {})
  const selectBlueprintColorRef = useRef<(color: string) => void>(() => {})
  const notesDirty = useRef(false)
  const blueprintPersistGen = useRef(0)
  const notePersistTimer = useRef<number | null>(null)
  userBlocksRef.current = userBlocks
  userIslandsRef.current = userIslands
  blueprintFunctionsRef.current = blueprintFunctions
  blueprintVariablesRef.current = blueprintVariables
  blueprintImportsRef.current = blueprintImports
  blueprintNotesRef.current = blueprintNotes
  blueprintPointersRef.current = blueprintPointers
  const namingId = userBlocks.find((block) => block.naming)?.id ?? null
  const namingIslandId = userIslands.find((island) => island.naming)?.id ?? null
  const previewGraph = useMemo(() => {
    if (!previewing) return graph
    return withPreviewGraph(
      graph,
      plannedCreates,
      changeSet.createLines ?? {},
      changeSet.createFolders ?? [],
      changeSet.imports ?? [],
    )
  }, [
    changeSet.createFolders,
    changeSet.createLines,
    changeSet.imports,
    graph,
    plannedCreates,
    previewing,
  ])
  const knownFileIds = useMemo(
    () => new Set(previewGraph.files.map((file) => file.id)),
    [previewGraph],
  )
  const knownFolderPaths = useMemo(
    () => new Set(previewGraph.folders.map((folder) => folder.path)),
    [previewGraph],
  )
  const visibleBlueprintColorSet = useMemo(
    () => new Set(visibleBlueprintColors),
    [visibleBlueprintColors],
  )
  const mapBlueprint = useMemo(
    () =>
      collectMapBlueprints({
        selectedColor: blueprintColor,
        visibleColors: visibleBlueprintColorSet,
        selectedBlocks: userBlocks,
        selectedIslands: userIslands,
        selectedFunctions: blueprintFunctions,
        selectedVariables: blueprintVariables,
        selectedImports: blueprintImports,
        selectedPointers: blueprintPointers,
        global: globalBlueprint,
        locals: localBlueprints,
      }),
    [
      blueprintColor,
      blueprintFunctions,
      blueprintImports,
      blueprintPointers,
      blueprintVariables,
      globalBlueprint,
      localBlueprints,
      userBlocks,
      userIslands,
      visibleBlueprintColorSet,
    ],
  )
  const blueprintOptions = useMemo(
    () => blueprintOptionsFrom(intents, localBlueprints),
    [intents, localBlueprints],
  )
  const blueprintColorPointers = useMemo(
    () =>
      blueprintOptions.map((option) => ({
        ...option,
        pointers:
          option.id === blueprintColor
            ? blueprintPointers
            : option.id === GLOBAL_BLUEPRINT_COLOR.id
              ? globalBlueprint.pointers
              : (localBlueprints.find((item) => item.color === option.id)
                  ?.pointers ?? []),
      })),
    [
      blueprintColor,
      blueprintOptions,
      blueprintPointers,
      globalBlueprint.pointers,
      localBlueprints,
    ],
  )
  const pointedColors = useMemo(
    () => pointerColorMaps(mapBlueprint.pointers),
    [mapBlueprint.pointers],
  )
  const pendingBlocks = mapBlueprint.blocks.filter(
    (block) => block.naming || !knownFileIds.has(block.id),
  )
  const visibleIslands = mapBlueprint.islands
  const displayGraph = useMemo(
    () =>
      withBlueprintIntent(
        withUserCreatedGraph(previewGraph, pendingBlocks, visibleIslands),
        mapBlueprint.functions,
        mapBlueprint.variables,
        mapBlueprint.imports,
      ),
    [
      mapBlueprint.functions,
      mapBlueprint.imports,
      mapBlueprint.variables,
      pendingBlocks,
      previewGraph,
      visibleIslands,
    ],
  )
  const layout = useMemo(() => {
    const world = layoutWorld(previewGraph)
    if (previewing) markCreatedFolders(world, changeSet.createFolders ?? [])
    return world
  }, [changeSet.createFolders, previewGraph, previewing])
  const changeFileIds = useMemo(() => {
    const ids = new Set<string>()
    for (const id of changeSet.files) ids.add(id)
    for (const id of changeSet.creates) ids.add(id)
    for (const id of changeSet.deletes) ids.add(id)
    for (const edge of changeSet.imports ?? []) {
      ids.add(edge.from)
      ids.add(edge.to)
    }
    for (const block of mapBlueprint.blocks) ids.add(block.id)
    for (const item of mapBlueprint.functions) ids.add(item.file)
    for (const item of mapBlueprint.variables) ids.add(item.file)
    for (const item of mapBlueprint.imports) ids.add(item.file)
    for (const note of blueprintNotes) ids.add(note.file)
    for (const pointer of mapBlueprint.pointers) {
      if (pointer.kind !== 'folder') ids.add(pointer.path)
    }
    return [...ids]
  }, [
    blueprintNotes,
    changeSet.creates,
    changeSet.deletes,
    changeSet.files,
    changeSet.imports,
    mapBlueprint,
  ])
  const changeFolderPaths = useMemo(() => {
    const paths = new Set<string>()
    for (const path of changeSet.createFolders ?? []) paths.add(path)
    for (const island of mapBlueprint.islands) {
      if (island.path) paths.add(island.path)
      else if (island.id) paths.add(island.id)
    }
    for (const pointer of mapBlueprint.pointers) {
      if (pointer.kind === 'folder') paths.add(pointer.path)
    }
    return [...paths]
  }, [changeSet.createFolders, mapBlueprint])
  const hasChangeSet =
    changeFileIds.length > 0 || changeFolderPaths.length > 0
  const changePathGraph = useMemo(() => {
    if (!hasChangeSet) return previewGraph
    return filterGraphToChangePaths(
      previewGraph,
      changeFileIds,
      changeFolderPaths,
    )
  }, [changeFileIds, changeFolderPaths, hasChangeSet, previewGraph])
  const changePathLayout = useMemo(() => {
    if (!hasChangeSet) return layout
    const world = layoutWorld(changePathGraph)
    markCreatedFolders(world, changeSet.createFolders ?? [])
    return world
  }, [changePathGraph, changeSet.createFolders, hasChangeSet, layout])
  const [mode, setMode] = useState<ViewMode>('map')
  const [explain, setExplain] = useState<ExplainSession>(emptyExplain)
  const [dismissedCardQuestion, setDismissedCardQuestion] = useState<
    string | null
  >(null)
  const dismissedCardQuestionRef = useRef<string | null>(null)
  dismissedCardQuestionRef.current = dismissedCardQuestion
  const cardExplain = explainIsCard(explain)
  const explaining =
    explain.active &&
    !cardExplain &&
    explain.question !== dismissedCardQuestion
  const [landAt, setLandAt] = useState<[number, number]>([
    layout.spawn[0],
    layout.spawn[2],
  ])
  const walkPos = useRef<[number, number]>([layout.spawn[0], layout.spawn[2]])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedTick, setSelectedTick] = useState(0)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [selectedFolderLayer, setSelectedFolderLayer] = useState<string | null>(
    null,
  )
  const [addingItem, setAddingItem] = useState<{
    kind: 'file' | 'folder'
    parent: string
    lockedColor: string | null
  } | null>(null)
  const [importPickFrom, setImportPickFrom] = useState<string | null>(null)
  const importPickFromRef = useRef<string | null>(null)
  importPickFromRef.current = importPickFrom
  const pickImportTargetRef = useRef<(fileId: string) => void>(() => {})
  const [mapMenu, setMapMenu] = useState<MapContextMenuState | null>(null)
  const [aimedRelation, setAimedRelation] = useState<AimedRelation | null>(null)
  const [aimedFileId, setAimedFileId] = useState<string | null>(null)
  const [inspectTick, setInspectTick] = useState(0)
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null)
  const [locked, setLocked] = useState(false)
  const [importedBy, setImportedBy] = useState(false)
  const [relationMode, setRelationMode] = useState<RelationMode>('changed')
  const [changePathsOnly, setChangePathsOnly] = useState(false)
  const lastIntentSig = useRef<string | null>(null)
  const viewedDiffId = useRef<Record<string, string | null>>({})
  const browsingHistory = useRef<Record<string, boolean>>({})
  const seenSessionIds = useRef<Set<string>>(new Set())

  const applyIntent = useCallback((next: AgentIntent, sessionId?: string) => {
    const targetId = next.sessionId ?? sessionId ?? null
    setIntents((current) => {
      const nextList =
        !targetId || next.status === 'idle' || !next.sessionId
          ? current.filter((item) => item.sessionId !== targetId)
          : current.some((item) => item.sessionId === targetId)
            ? current.map((item) => (item.sessionId === targetId ? next : item))
            : [...current, next]
      setFocusedSessionId((currentFocus) => {
        if (
          currentFocus &&
          nextList.some((item) => item.sessionId === currentFocus)
        ) {
          return currentFocus
        }
        return nextList[0]?.sessionId ?? null
      })
      return nextList
    })
    if (targetId && next.sessionId) viewedDiffId.current[targetId] = next.diffId
  }, [])

  const focusSessionPanel = useCallback((sessionId: string) => {
    setFocusedSessionId(sessionId)
    persistSessionFocus(sessionId)
  }, [])

  const rememberWalk = useCallback((x: number, z: number) => {
    walkPos.current = [x, z]
  }, [])

  const openMap = useCallback(() => {
    setLandAt(walkPos.current)
    setLocked(false)
    document.exitPointerLock()
    setMode('map')
  }, [])

  const openWalk = useCallback(() => {
    if (explaining) return
    setMode('walk')
  }, [explaining])

  const toggleMap = useCallback(() => {
    if (explaining) return
    if (mode === 'walk') {
      setLandAt(walkPos.current)
      setFlyTo(null)
      setLocked(false)
      document.exitPointerLock()
      setMode('map')
      return
    }
    setMode('walk')
  }, [explaining, mode])

  const land = useCallback((x: number, z: number) => {
    if (explaining) return
    walkPos.current = [x, z]
    setFlyTo(null)
    setLandAt([x, z])
    setMode('walk')
  }, [explaining])

  const landFromMap = useCallback(
    (x: number, z: number) => {
      if (!changePathsOnly || !hasChangeSet) {
        land(x, z)
        return
      }
      const mapped = mapPointOntoFolder(x, z, changePathLayout, layout, [
        layout.spawn[0],
        layout.spawn[2],
      ])
      if (!mapped) return
      land(mapped[0], mapped[1])
    },
    [changePathLayout, changePathsOnly, hasChangeSet, land, layout],
  )

  const travelToFile = useCallback(
    (fileId: string, fly: boolean) => {
      const placed = layout.files[fileId]
      if (!placed) return
      const from = walkPos.current
      const [x, z] = standInFront(placed)
      walkPos.current = [x, z]
      setAimedRelation(null)
      setLandAt([x, z])
      setFlyTo(
        fly
          ? {
              nonce: Date.now(),
              from: [from[0], from[1]],
              lookAt: [placed.position[0], placed.position[1], placed.position[2]],
            }
          : null,
      )
      setMode('walk')
    },
    [layout.files],
  )

  const flyAlongRelation = useCallback(
    (fromId: string, toId: string) => {
      if (mode !== 'walk') return
      const [x, z] = walkPos.current
      travelToFile(relationTravelTarget(fromId, toId, x, z, layout.files), true)
    },
    [layout.files, mode, travelToFile],
  )

  const runWorkflowAction = useCallback(
    async (
      sessionId: string,
      action: WorkflowAction,
      options: { step?: number; stepByStep?: boolean } = {},
    ) => {
      const current = intents.find((item) => item.sessionId === sessionId)
      if (!current?.sessionId) return false
      if (
        action === 'continue' &&
        (!current.diffId || !current.isActiveDiff)
      ) {
        return false
      }
      try {
        if (action === 'blueprint_send') persistBlueprintRef.current()
        const next = await performAgentAction(
          action,
          current.sessionId,
          {
            ...options,
            diffId: current.diffId ?? undefined,
          },
        )
        browsingHistory.current[sessionId] = false
        lastIntentSig.current = null
        applyIntent(next, sessionId)
        if (
          action === 'continue' ||
          action === 'stop' ||
          action === 'set_step_by_step'
        ) {
          await onRefreshGraph()
        }
        return next
      } catch {
        // Keep the pending patch visible if apply failed.
        return false
      }
    },
    [
      applyIntent,
      intents,
      onRefreshGraph,
    ],
  )

  const navigateDiff = useCallback(
    async (sessionId: string, diffId: string) => {
      const current = intents.find((item) => item.sessionId === sessionId)
      if (!current) return
      try {
        const latest = current.chain.at(-1)?.id
        browsingHistory.current[sessionId] = diffId !== latest
        try {
          await inspectTargetFile({
            sessionId,
            diffId,
          })
        } catch {
          // Still show the historical preview if disk replay failed.
        }
        const next = await fetchAgentIntent(sessionId, diffId)
        lastIntentSig.current = null
        applyIntent(next, sessionId)
        setFocusedSessionId(sessionId)
      } catch {
        // Keep the current chain position if navigation failed.
      }
    },
    [applyIntent, intents],
  )

  const inspectFile = useCallback(
    async (fileId: string) => {
      try {
        await inspectTargetFile({
          sessionId: intent.sessionId,
          diffId: intent.diffId,
          fileId,
        })
      } catch {
        // Keep the current view if the editor could not open the file.
      }
    },
    [intent.diffId, intent.sessionId],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'KeyM') return
      if (shouldIgnoreShortcut(event)) return
      event.preventDefault()
      toggleMap()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleMap])

  useEffect(() => {
    let cancelled = false
    void fetchUserContext().then((context) => {
      if (cancelled) return
      if (typeof context?.showBranchChanges === 'boolean') {
        setWantBranchChanges(context.showBranchChanges)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      const next = await fetchExplain()
      if (cancelled) return
      setExplain((current) => {
        if (
          current.presentation === 'card' &&
          current.active &&
          current.pendingStart &&
          !next.active
        ) {
          return current
        }
        const dismissed = dismissedCardQuestionRef.current
        if (
          next.presentation === 'card' &&
          next.active &&
          dismissed &&
          next.question === dismissed
        ) {
          return current.active ? current : emptyExplain()
        }
        return mergeExplainPoll(current, next)
      })
    }
    void poll()
    const timer = window.setInterval(() => {
      void poll()
    }, 250)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (explain.active && mode !== 'map') openMap()
  }, [explain.active, mode, openMap])

  useEffect(() => {
    if (
      explain.active &&
      explain.presentation !== 'card' &&
      dismissedCardQuestion &&
      explain.question !== dismissedCardQuestion
    ) {
      setDismissedCardQuestion(null)
    }
  }, [
    dismissedCardQuestion,
    explain.active,
    explain.presentation,
    explain.question,
  ])

  const goExplainStep = useCallback((step: string) => {
    setExplain((current) =>
      current.active ? { ...current, currentStep: step } : current,
    )
    void persistExplainStep(step)
  }, [])

  const exitExplain = useCallback(() => {
    setExplain(emptyExplain())
    void persistExplainStop()
  }, [])

  const closeAskCard = useCallback(() => {
    setDismissedCardQuestion(explain.question)
    exitExplain()
  }, [exitExplain, explain.question])

  const startExplainTarget = useCallback(
    (input: { kind: ExplainTargetKind; path: string; name?: string }) => {
      const target = input.path.trim()
      const name = input.name?.trim()
      if (!target) return
      if (
        (input.kind === 'function' ||
          input.kind === 'variable' ||
          input.kind === 'class') &&
        !name
      ) {
        return
      }
      const question = explainTargetQuestion(input.kind, target, name)
      setDismissedCardQuestion(null)
      setExplain({
        active: true,
        question,
        steps: [],
        currentStep: '1',
        pendingQuestion: null,
        pendingStart: name
          ? { kind: input.kind, path: target, name, question }
          : { kind: input.kind, path: target, question },
        answering: false,
        presentation: 'card',
        updatedAt: new Date().toISOString(),
      })
      void persistExplainStart({
        kind: input.kind,
        path: target,
        name,
        sessionId: focusedSessionId ?? intent.sessionId,
      })
    },
    [focusedSessionId, intent.sessionId],
  )

  const rememberLiveBlueprint = useCallback(
    (
      color: string = blueprintColorRef.current,
      snapshot: {
        hidden?: boolean
        blocks?: UserCreatedBlock[]
        islands?: UserCreatedIsland[]
        functions?: PatchSymbolAddition[]
        variables?: PatchSymbolAddition[]
        imports?: PatchImportAddition[]
        notes?: BlueprintNote[]
        pointers?: BlueprintPointer[]
      } = {},
    ) => {
      const next = withCapturedBlueprint(latestBlueprintsRef.current, {
        color,
        hidden: snapshot.hidden ?? blueprintHiddenRef.current,
        blocks: snapshot.blocks ?? userBlocksRef.current,
        islands: snapshot.islands ?? userIslandsRef.current,
        functions: snapshot.functions ?? blueprintFunctionsRef.current,
        variables: snapshot.variables ?? blueprintVariablesRef.current,
        imports: snapshot.imports ?? blueprintImportsRef.current,
        notes: snapshot.notes ?? blueprintNotesRef.current,
        pointers: snapshot.pointers ?? blueprintPointersRef.current,
        options: blueprintOptionsRef.current,
      })
      latestBlueprintsRef.current = next
      setGlobalBlueprint(next.global)
      setLocalBlueprints(next.locals)
    },
    [],
  )

  const persistBlueprint = useCallback(
    (
      blocks: UserCreatedBlock[] = userBlocksRef.current,
      islands: UserCreatedIsland[] = userIslandsRef.current,
      functions: PatchSymbolAddition[] = blueprintFunctionsRef.current,
      variables: PatchSymbolAddition[] = blueprintVariablesRef.current,
      imports: PatchImportAddition[] = blueprintImportsRef.current,
      notes: BlueprintNote[] = blueprintNotesRef.current,
      pointers: BlueprintPointer[] = blueprintPointersRef.current,
      color: string = blueprintColorRef.current,
    ) => {
      rememberLiveBlueprint(color, {
        blocks,
        islands,
        functions,
        variables,
        imports,
        notes,
        pointers,
      })
      if (notePersistTimer.current != null) {
        window.clearTimeout(notePersistTimer.current)
        notePersistTimer.current = null
      }
      const gen = ++blueprintPersistGen.current
      notesDirty.current = true
      void persistSessionBlueprint(intent.sessionId, {
        color,
        userCreatedBlocks: namedCreatedBlocks(blocks),
        userCreatedIslands: namedCreatedIslands(islands),
        addedFunctions: functions,
        addedVariables: variables,
        addedImports: imports,
        notes,
        pointers,
      }).finally(() => {
        if (gen !== blueprintPersistGen.current) return
        if (notePersistTimer.current != null) return
        notesDirty.current = false
        blueprintPersistGen.current += 1
      })
    },
    [intent.sessionId, rememberLiveBlueprint],
  )
  persistBlueprintRef.current = () => persistBlueprint()

  const persistBlueprintSoon = useCallback(() => {
    notesDirty.current = true
    if (notePersistTimer.current != null) {
      window.clearTimeout(notePersistTimer.current)
    }
    notePersistTimer.current = window.setTimeout(() => {
      persistBlueprint()
    }, 400)
  }, [persistBlueprint])

  useEffect(() => {
    return () => {
      if (notePersistTimer.current == null) return
      window.clearTimeout(notePersistTimer.current)
      notePersistTimer.current = null
      if (!notesDirty.current) return
      persistSessionBlueprint(intent.sessionId, {
        color: blueprintColorRef.current,
        userCreatedBlocks: namedCreatedBlocks(userBlocksRef.current),
        userCreatedIslands: namedCreatedIslands(userIslandsRef.current),
        addedFunctions: blueprintFunctionsRef.current,
        addedVariables: blueprintVariablesRef.current,
        addedImports: blueprintImportsRef.current,
        notes: blueprintNotesRef.current,
        pointers: blueprintPointersRef.current,
      })
      notesDirty.current = false
    }
  }, [intent.sessionId])

  const applyBlueprintNote = useCallback(
    (next: {
      file: string
      kind: BlueprintNoteKind
      name?: string
      note: string
    }) => {
      const notes = setBlueprintNote(blueprintNotesRef.current, next)
      blueprintNotesRef.current = notes
      setBlueprintNotes(notes)
      persistBlueprintSoon()
    },
    [persistBlueprintSoon],
  )

  const applyBlueprintPointer = useCallback(
    (next: {
      kind: BlueprintPointerKind
      path: string
      name?: string
      color?: string
    }) => {
      const { color, ...pointer } = next
      if (color) selectBlueprintColorRef.current(color)
      const pointers = toggleBlueprintPointer(
        blueprintPointersRef.current,
        pointer,
      )
      blueprintPointersRef.current = pointers
      setBlueprintPointers(pointers)
      persistBlueprint(
        userBlocksRef.current,
        userIslandsRef.current,
        blueprintFunctionsRef.current,
        blueprintVariablesRef.current,
        blueprintImportsRef.current,
        blueprintNotesRef.current,
        pointers,
      )
    },
    [persistBlueprint],
  )

  const ownerColorForCreatedFolder = useCallback((folderPath: string) => {
    const matches = (island: UserCreatedIsland) =>
      !island.naming && createdIslandKey(island) === folderPath
    if (userIslandsRef.current.some(matches)) return blueprintColorRef.current
    const { global, locals } = latestBlueprintsRef.current
    if (global.userCreatedIslands.some(matches)) return GLOBAL_BLUEPRINT_COLOR.id
    return (
      locals.find((item) => item.userCreatedIslands.some(matches))?.color ?? null
    )
  }, [])

  const beginAddFile = useCallback(
    (folderPath: string, color?: string) => {
      if (!canPlace) return
      setAddingItem({
        kind: 'file',
        parent: folderPath,
        lockedColor: color ?? ownerColorForCreatedFolder(folderPath),
      })
      document.exitPointerLock()
    },
    [canPlace, ownerColorForCreatedFolder],
  )

  const renameCreatedBlock = useCallback(
    (id: string, rawName: string) => {
      const current = userBlocks.find((block) => block.id === id)
      if (!current || current.naming) return null
      const resolved = resolveCreatedFile(rawName, current.folder)
      if (!resolved) return null
      if (resolved.id === id) return id
      const taken = userBlocks.some(
        (block) => block.id === resolved.id && block.id !== id,
      )
      if (taken) return null
      const nextBlocks = userBlocks.map((block) =>
        block.id === id
          ? {
              ...resolved,
              x: current.x,
              z: current.z,
              colorHex: current.colorHex,
            }
          : block,
      )
      const remapped = remapBlueprintFileId(id, resolved.id, {
        functions: blueprintFunctionsRef.current,
        variables: blueprintVariablesRef.current,
        imports: blueprintImportsRef.current,
        notes: blueprintNotesRef.current,
        pointers: blueprintPointersRef.current,
      })
      blueprintNotesRef.current = remapped.notes
      blueprintPointersRef.current = remapped.pointers
      setUserBlocks(nextBlocks)
      setBlueprintFunctions(remapped.functions)
      setBlueprintVariables(remapped.variables)
      setBlueprintImports(remapped.imports)
      setBlueprintNotes(remapped.notes)
      setBlueprintPointers(remapped.pointers)
      persistBlueprint(
        nextBlocks,
        userIslands,
        remapped.functions,
        remapped.variables,
        remapped.imports,
        remapped.notes,
        remapped.pointers,
      )
      if (selectedId === id) setSelectedId(resolved.id)
      return resolved.id
    },
    [persistBlueprint, selectedId, userBlocks, userIslands],
  )

  const beginAddFolder = useCallback(
    (parent: string, color?: string) => {
      if (!canPlace) return
      setAddingItem({
        kind: 'folder',
        parent,
        lockedColor: color ?? ownerColorForCreatedFolder(parent),
      })
      document.exitPointerLock()
    },
    [canPlace, ownerColorForCreatedFolder],
  )

  const createdContentsForColor = useCallback((color: string) => {
    if (color === blueprintColorRef.current) {
      return {
        blocks: userBlocksRef.current,
        islands: userIslandsRef.current,
        functions: blueprintFunctionsRef.current,
        variables: blueprintVariablesRef.current,
        imports: blueprintImportsRef.current,
        notes: blueprintNotesRef.current,
        pointers: blueprintPointersRef.current,
      }
    }
    const stored = blueprintForColor(
      color,
      latestBlueprintsRef.current.global,
      latestBlueprintsRef.current.locals,
    )
    return {
      blocks: stored.userCreatedBlocks,
      islands: stored.userCreatedIslands,
      functions: stored.addedFunctions,
      variables: stored.addedVariables,
      imports: stored.addedImports,
      notes: stored.notes,
      pointers: stored.pointers,
    }
  }, [])

  const removeCreatedItems = useCallback(
    (
      color: string,
      removedBlockIds: Iterable<string>,
      removedFolderPaths: Iterable<string> = [],
    ) => {
      const next = omitCreatedItems(
        createdContentsForColor(color),
        removedBlockIds,
        removedFolderPaths,
      )
      if (color === blueprintColorRef.current) {
        blueprintNotesRef.current = next.notes
        blueprintPointersRef.current = next.pointers
        setUserBlocks(next.blocks)
        setUserIslands(next.islands)
        setBlueprintFunctions(next.functions)
        setBlueprintVariables(next.variables)
        setBlueprintImports(next.imports)
        setBlueprintNotes(next.notes)
        setBlueprintPointers(next.pointers)
      }
      persistBlueprint(
        next.blocks,
        next.islands,
        next.functions,
        next.variables,
        next.imports,
        next.notes,
        next.pointers,
        color,
      )
    },
    [createdContentsForColor, persistBlueprint],
  )

  const ownerColorForCreatedFile = useCallback((fileId: string) => {
    if (
      userBlocksRef.current.some(
        (block) => block.id === fileId && !block.naming,
      )
    ) {
      return blueprintColorRef.current
    }
    const { global, locals } = latestBlueprintsRef.current
    if (global.userCreatedBlocks.some((block) => block.id === fileId)) {
      return GLOBAL_BLUEPRINT_COLOR.id
    }
    return (
      locals.find((item) =>
        item.userCreatedBlocks.some((block) => block.id === fileId),
      )?.color ?? null
    )
  }, [])

  const deleteSelectedCreated = useCallback(() => {
    if (!canPlace) return false
    if (selectedId) {
      const color = ownerColorForCreatedFile(selectedId)
      if (!color) return false
      const selected = createdContentsForColor(color).blocks.find(
        (block) => block.id === selectedId,
      )
      if (!selected || selected.naming) return false
      removeCreatedItems(color, [selectedId])
      setSelectedId(null)
      return true
    }
    if (!selectedFolder) return false
    const color =
      selectedFolderLayer ?? ownerColorForCreatedFolder(selectedFolder)
    if (!color) return false
    const source = createdContentsForColor(color)
    const selected = source.islands.find(
      (island) =>
        !island.naming && createdIslandKey(island) === selectedFolder,
    )
    if (!selected) return false
    const folderPath = createdIslandKey(selected)
    const { removedBlocks, removedIslands } = createdItemsInsideFolder(
      folderPath,
      source.blocks,
      source.islands,
    )
    removeCreatedItems(
      color,
      removedBlocks.map((block) => block.id),
      removedIslands.map((island) => createdIslandKey(island)),
    )
    setSelectedFolder(null)
    setSelectedFolderLayer(null)
    return true
  }, [
    canPlace,
    createdContentsForColor,
    ownerColorForCreatedFile,
    ownerColorForCreatedFolder,
    removeCreatedItems,
    selectedFolder,
    selectedFolderLayer,
    selectedId,
  ])

  const selectFile = useCallback(
    (fileId: string | null) => {
      const pickFrom = importPickFromRef.current
      if (pickFrom) {
        if (fileId && fileId !== pickFrom) pickImportTargetRef.current(fileId)
        return
      }
      setSelectedId(fileId)
      if (fileId) {
        setSelectedFolder(null)
        setSelectedFolderLayer(null)
        setSelectedTick((tick) => tick + 1)
      }
      if (fileId && canPlace) document.exitPointerLock()
    },
    [canPlace],
  )

  const inspectBlock = useCallback(
    (fileId: string) => {
      selectFile(fileId)
      setInspectTick((tick) => tick + 1)
    },
    [selectFile],
  )

  const selectFolder = useCallback(
    (folderPath: string | null, layer?: string | null) => {
      if (importPickFromRef.current) return
      setSelectedFolder(folderPath)
      setSelectedFolderLayer(folderPath ? layer ?? null : null)
      if (folderPath) setSelectedId(null)
    },
    [],
  )

  useEffect(() => {
    if (!changePathsOnly || !hasChangeSet) return
    if (selectedFolder && !changePathLayout.folders[selectedFolder]) {
      setSelectedFolder(null)
      setSelectedFolderLayer(null)
    }
    if (
      selectedId &&
      !changePathGraph.files.some((file) => file.id === selectedId)
    ) {
      setSelectedId(null)
    }
  }, [
    changePathGraph.files,
    changePathLayout.folders,
    changePathsOnly,
    hasChangeSet,
    selectedFolder,
    selectedId,
  ])

  const addBlueprintFunction = useCallback(
    (fileId: string, rawName: string) => {
      if (!canPlace || fileId.startsWith('draft:')) return false
      const name = rawName.trim()
      if (!isBlueprintSymbolName(name)) return false
      const exists =
        displayGraph.files
          .find((file) => file.id === fileId)
          ?.symbols.some(
            (symbol) => symbol.kind === 'function' && symbol.name === name,
          ) ||
        blueprintFunctions.some(
          (item) => item.file === fileId && item.name === name,
        )
      if (exists) return false
      const next = [...blueprintFunctions, { name, file: fileId }]
      setBlueprintFunctions(next)
      persistBlueprint(userBlocks, userIslands, next, blueprintVariables, blueprintImports)
      return true
    },
    [
      blueprintFunctions,
      blueprintImports,
      blueprintVariables,
      displayGraph.files,
      canPlace,
      persistBlueprint,
      userBlocks,
      userIslands,
    ],
  )

  const addBlueprintVariable = useCallback(
    (fileId: string, rawName: string) => {
      if (!canPlace || fileId.startsWith('draft:')) return false
      const name = rawName.trim()
      if (!isBlueprintSymbolName(name)) return false
      const exists =
        displayGraph.files
          .find((file) => file.id === fileId)
          ?.symbols.some(
            (symbol) => symbol.kind === 'variable' && symbol.name === name,
          ) ||
        blueprintVariables.some(
          (item) => item.file === fileId && item.name === name,
        )
      if (exists) return false
      const next = [...blueprintVariables, { name, file: fileId }]
      setBlueprintVariables(next)
      persistBlueprint(userBlocks, userIslands, blueprintFunctions, next, blueprintImports)
      return true
    },
    [
      blueprintFunctions,
      blueprintImports,
      blueprintVariables,
      displayGraph.files,
      canPlace,
      persistBlueprint,
      userBlocks,
      userIslands,
    ],
  )

  const addBlueprintImport = useCallback(
    (fileId: string, raw: string) => {
      if (!canPlace || fileId.startsWith('draft:')) return false
      const parsed = parseBlueprintImport(
        raw,
        fileId,
        displayGraph.files.map((file) => file.id),
      )
      if (!parsed) return false
      const exists = blueprintImports.some(
        (item) =>
          item.file === fileId &&
          item.name === parsed.name &&
          item.from === parsed.from,
      )
      if (exists) return false
      const next = [...blueprintImports, parsed]
      setBlueprintImports(next)
      persistBlueprint(
        userBlocks,
        userIslands,
        blueprintFunctions,
        blueprintVariables,
        next,
      )
      return true
    },
    [
      blueprintFunctions,
      blueprintImports,
      blueprintVariables,
      displayGraph.files,
      canPlace,
      persistBlueprint,
      userBlocks,
      userIslands,
    ],
  )

  pickImportTargetRef.current = (fileId: string) => {
    const from = importPickFromRef.current
    if (!from || fileId.startsWith('draft:')) return
    const target = displayGraph.files.find((file) => file.id === fileId)
    if (!target) return
    addBlueprintImport(from, blueprintImportRawFromFile(target))
    setImportPickFrom(null)
  }

  const cancelImportPick = useCallback(() => {
    setImportPickFrom(null)
  }, [])

  const toggleImportPick = useCallback(() => {
    setImportPickFrom((current) => (current ? null : selectedId))
  }, [selectedId])

  const removeBlueprintFunction = useCallback(
    (fileId: string, name: string) => {
      if (!canPlace) return
      const next = blueprintFunctions.filter(
        (item) => !(item.file === fileId && item.name === name),
      )
      const notes = dropBlueprintSymbolNote(
        blueprintNotesRef.current,
        fileId,
        'function',
        name,
      )
      const pointers = dropBlueprintSymbolPointer(
        blueprintPointersRef.current,
        fileId,
        'function',
        name,
      )
      blueprintNotesRef.current = notes
      blueprintPointersRef.current = pointers
      setBlueprintFunctions(next)
      setBlueprintNotes(notes)
      setBlueprintPointers(pointers)
      persistBlueprint(
        userBlocks,
        userIslands,
        next,
        blueprintVariables,
        blueprintImports,
        notes,
        pointers,
      )
    },
    [
      blueprintFunctions,
      blueprintImports,
      blueprintVariables,
      canPlace,
      persistBlueprint,
      userBlocks,
      userIslands,
    ],
  )

  const removeBlueprintVariable = useCallback(
    (fileId: string, name: string) => {
      if (!canPlace) return
      const next = blueprintVariables.filter(
        (item) => !(item.file === fileId && item.name === name),
      )
      const notes = dropBlueprintSymbolNote(
        blueprintNotesRef.current,
        fileId,
        'variable',
        name,
      )
      const pointers = dropBlueprintSymbolPointer(
        blueprintPointersRef.current,
        fileId,
        'variable',
        name,
      )
      blueprintNotesRef.current = notes
      blueprintPointersRef.current = pointers
      setBlueprintVariables(next)
      setBlueprintNotes(notes)
      setBlueprintPointers(pointers)
      persistBlueprint(
        userBlocks,
        userIslands,
        blueprintFunctions,
        next,
        blueprintImports,
        notes,
        pointers,
      )
    },
    [
      blueprintFunctions,
      blueprintImports,
      blueprintVariables,
      canPlace,
      persistBlueprint,
      userBlocks,
      userIslands,
    ],
  )

  const removeBlueprintImport = useCallback(
    (fileId: string, name: string, from: string) => {
      if (!canPlace) return
      const next = blueprintImports.filter(
        (item) =>
          !(item.file === fileId && item.name === name && item.from === from),
      )
      setBlueprintImports(next)
      persistBlueprint(
        userBlocks,
        userIslands,
        blueprintFunctions,
        blueprintVariables,
        next,
      )
    },
    [
      blueprintFunctions,
      blueprintImports,
      blueprintVariables,
      canPlace,
      persistBlueprint,
      userBlocks,
      userIslands,
    ],
  )

  useEffect(() => {
    if (!addingItem) return
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return
      if (shouldIgnoreShortcut(event)) return
      event.preventDefault()
      setAddingItem(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addingItem])

  useEffect(() => {
    if (mode !== 'map' || importedBy || !selectedId || addingItem) {
      setImportPickFrom(null)
    }
  }, [addingItem, importedBy, mode, selectedId])

  useEffect(() => {
    if (!importPickFrom) return
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return
      if (isKeyboardIsolated()) return
      event.preventDefault()
      event.stopPropagation()
      setImportPickFrom(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [importPickFrom])

  useEffect(() => {
    if (mode !== 'map' || addingItem) setMapMenu(null)
  }, [addingItem, mode])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || (event.code !== 'Backspace' && event.code !== 'Delete'))
        return
      if (shouldIgnoreShortcut(event)) return
      if (!deleteSelectedCreated()) return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleteSelectedCreated])

  const canToggleBranchChanges = !llmBusy && (wantBranchChanges || branchChanges.available)

  const toggleShowBranchChanges = useCallback(() => {
    if (llmBusy) return
    if (!wantBranchChanges && !branchChanges.available) return
    setWantBranchChanges((current) => {
      const next = !current
      persistShowBranchChanges(next)
      return next
    })
  }, [branchChanges.available, llmBusy, wantBranchChanges])

  const toggleImportedBy = useCallback(() => {
    if (!selectedId) return
    setImportedBy((current) => !current)
  }, [selectedId])

  useEffect(() => {
    if (!selectedId) setImportedBy(false)
  }, [selectedId])

  const setRelationModeAndClearAim = useCallback((mode: RelationMode) => {
    setRelationMode(mode)
    setAimedRelation(null)
  }, [])

  const cycleRelationMode = useCallback(() => {
    setRelationMode((current) => {
      const order: RelationMode[] = ['all', 'off', 'changed', 'targeted']
      return order[(order.indexOf(current) + 1) % order.length]
    })
    setAimedRelation(null)
  }, [])

  const toggleChangePathsOnly = useCallback(() => {
    if (!hasChangeSet) return
    setChangePathsOnly((current) => !current)
  }, [hasChangeSet])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'KeyK') return
      if (shouldIgnoreShortcut(event)) return
      event.preventDefault()
      toggleImportedBy()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleImportedBy])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'KeyG') return
      if (shouldIgnoreShortcut(event)) return
      if (!canToggleBranchChanges) return
      event.preventDefault()
      toggleShowBranchChanges()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canToggleBranchChanges, toggleShowBranchChanges])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const next = await fetchBranchChanges()
      if (!cancelled) setBranchChanges(next)
    }
    void load()
    if (!wantBranchChanges || llmBusy) {
      return () => {
        cancelled = true
      }
    }
    const timer = window.setInterval(() => {
      void load()
    }, 2000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [llmBusy, updatingModel, wantBranchChanges])

  useEffect(() => {
    if (mode !== 'map') return
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'KeyR') return
      if (shouldIgnoreShortcut(event)) return
      event.preventDefault()
      cycleRelationMode()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, cycleRelationMode])

  useEffect(() => {
    if (mode !== 'map' || !hasChangeSet) return
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'KeyC') return
      if (shouldIgnoreShortcut(event)) return
      event.preventDefault()
      toggleChangePathsOnly()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasChangeSet, mode, toggleChangePathsOnly])

  const applyBlueprintContents = useCallback(
    (blueprint: SharedBlueprint, keepDrafts = true) => {
      blueprintHiddenRef.current = Boolean(blueprint.hidden)
      setBlueprintHidden(Boolean(blueprint.hidden))
      const nextBlocks = parseUserCreatedBlocks(blueprint.userCreatedBlocks)
      const nextIslands = parseUserCreatedIslands(blueprint.userCreatedIslands)
      setUserBlocks((current) => {
        if (!keepDrafts) return nextBlocks
        const drafts = current.filter((block) => block.naming)
        if (drafts.length === 0) return nextBlocks
        const namedIds = new Set(drafts.map((block) => block.id))
        return [...nextBlocks.filter((block) => !namedIds.has(block.id)), ...drafts]
      })
      setUserIslands((current) => {
        if (!keepDrafts) return nextIslands
        const drafts = current.filter((island) => island.naming)
        if (drafts.length === 0) return nextIslands
        const namedIds = new Set(drafts.map((island) => island.id))
        return [...nextIslands.filter((island) => !namedIds.has(island.id)), ...drafts]
      })
      setBlueprintFunctions(blueprint.addedFunctions)
      setBlueprintVariables(blueprint.addedVariables)
      setBlueprintImports(blueprint.addedImports)
      if (!keepDrafts || !notesDirty.current) {
        const nextPointers = parseBlueprintPointers(blueprint.pointers)
        blueprintPointersRef.current = nextPointers
        setBlueprintPointers(nextPointers)
      }
      if (!keepDrafts || (!notesDirty.current && !isKeyboardIsolated())) {
        const nextNotes = parseBlueprintNotes(blueprint.notes)
        blueprintNotesRef.current = nextNotes
        setBlueprintNotes(nextNotes)
      }
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const persistGen = blueprintPersistGen.current
        const bundle = await fetchAgentIntents()
        if (cancelled) return
        if (
          !notesDirty.current &&
          persistGen === blueprintPersistGen.current
        ) {
          const nextBlueprints = withPolledBlueprints(latestBlueprintsRef.current, {
            global: bundle.blueprint,
            locals: bundle.localBlueprints,
          })
          latestBlueprintsRef.current = nextBlueprints
          setGlobalBlueprint(nextBlueprints.global)
          setLocalBlueprints(nextBlueprints.locals)
          const colorIds = new Set([
            GLOBAL_BLUEPRINT_COLOR.id,
            ...bundle.localBlueprints.map((item) => item.color),
            ...bundle.intents
              .map((item) => item.color)
              .filter((id): id is string => Boolean(id)),
          ])
          if (!colorIds.has(blueprintColorRef.current)) {
            blueprintColorRef.current = GLOBAL_BLUEPRINT_COLOR.id
            setBlueprintColor(GLOBAL_BLUEPRINT_COLOR.id)
          }
          const visible = visibleBlueprintColorsRef.current
          const nextVisible = visible.filter((id) => colorIds.has(id))
          if (nextVisible.length !== visible.length) {
            visibleBlueprintColorsRef.current = nextVisible
            setVisibleBlueprintColors(nextVisible)
          }
          applyBlueprintContents(
            blueprintForColor(
              blueprintColorRef.current,
              nextBlueprints.global,
              nextBlueprints.locals,
            ),
          )
        }
        setNextAttachSessionId(bundle.nextAttachSessionId)
        const merged: AgentIntent[] = []
        for (const next of bundle.intents) {
          const sessionId = next.sessionId
          if (
            sessionId &&
            browsingHistory.current[sessionId] &&
            viewedDiffId.current[sessionId]
          ) {
            merged.push(
              await fetchAgentIntent(sessionId, viewedDiffId.current[sessionId] ?? undefined),
            )
          } else {
            merged.push(next)
          }
        }
        const signature = JSON.stringify(merged.map(intentSignature))
        if (cancelled || signature === lastIntentSig.current) {
          return
        }
        lastIntentSig.current = signature
        setIntents(merged)
        for (const next of merged) {
          if (next.sessionId && !browsingHistory.current[next.sessionId]) {
            viewedDiffId.current[next.sessionId] = next.diffId
          }
        }
        const nextIds = new Set(
          merged
            .map((item) => item.sessionId)
            .filter((id): id is string => Boolean(id)),
        )
        const serverFocus = bundle.focusedSessionId
        const appeared =
          serverFocus != null && !seenSessionIds.current.has(serverFocus)
        seenSessionIds.current = nextIds
        setFocusedSessionId((current) => {
          if (appeared && serverFocus && nextIds.has(serverFocus)) {
            return serverFocus
          }
          if (current && nextIds.has(current)) {
            return current
          }
          if (serverFocus && nextIds.has(serverFocus)) {
            return serverFocus
          }
          return merged[0]?.sessionId ?? null
        })
      } catch {
        // Explorer may be running without the intent endpoint yet.
      }
    }
    void poll()
    const timer = window.setInterval(() => {
      void poll()
    }, 250)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [applyBlueprintContents])

  const plannedIds = previewing ? [...changeSet.files, ...changeSet.creates] : []
  const blueprintImportEdges = mapBlueprint.imports.flatMap((item) => {
    if (!displayGraph.files.some((file) => file.id === item.from)) return []
    return [{ from: item.file, to: item.from }]
  })
  const plannedImports = [
    ...(previewing ? (changeSet.imports ?? []) : []),
    ...blueprintImportEdges,
  ]
  const deletedIds = previewing ? changeSet.deletes : []
  const blueprintHasContent = visibleBlueprintColors.some((color) => {
    const contents = createdContentsForColor(color)
    return blueprintLiveEnabled(
      contents.blocks,
      contents.islands,
      contents.functions,
      contents.variables,
      contents.imports,
      contents.notes,
      contents.pointers,
    )
  })
  const blueprintCanCleanup = visibleBlueprintColors.some((color) => {
    const contents = createdContentsForColor(color)
    return (
      contents.blocks.some(
        (block) => !block.naming && knownFileIds.has(block.id),
      ) ||
      contents.islands.some(
        (island) => !island.naming && knownFolderPaths.has(island.path),
      )
    )
  })
  const canDeleteSelected =
    Boolean(
      selectedId &&
        mapBlueprint.blocks.some(
          (block) => block.id === selectedId && !block.naming,
        ),
    ) ||
    Boolean(
      selectedFolder &&
        (selectedFolderLayer
          ? createdContentsForColor(selectedFolderLayer)
          : mapBlueprint
        ).islands.some(
          (island) =>
            !island.naming && createdIslandKey(island) === selectedFolder,
        ),
    )
  const canAskLlm =
    Boolean(intent.sessionId) &&
    isReviewingIntent(intent.status) &&
    intent.awaitingAttach === false &&
    !intent.llmIdle

  const explainStep = currentExplainStep(explain)
  const explainView = useMemo(
    () => (explaining ? explainFocus(explainStep, displayGraph) : null),
    [displayGraph, explainStep, explaining],
  )
  const mapLayoutForView =
    !explaining && changePathsOnly && hasChangeSet ? changePathLayout : layout
  const overlayLayers = useMemo(
    () => layoutBlueprintLayers(mapLayoutForView, mapBlueprint.layers),
    [mapBlueprint.layers, mapLayoutForView],
  )
  useEffect(() => {
    if (!selectedFolderLayer) return
    if (overlayLayers.some((layer) => layer.id === selectedFolderLayer)) return
    setSelectedFolder(null)
    setSelectedFolderLayer(null)
  }, [overlayLayers, selectedFolderLayer])
  const placementLayout = useMemo(
    () => mergeOverlayOnlyFolders(mapLayoutForView, overlayLayers),
    [mapLayoutForView, overlayLayers],
  )
  placementLayoutRef.current = placementLayout
  const explainBounds = useMemo(() => {
    if (!explaining || !explainView) return null
    if (
      explainView.zoomFiles.length === 0 &&
      explainView.zoomFolders.length === 0
    ) {
      return null
    }
    return regionBounds(
      mapLayoutForView,
      explainView.zoomFiles,
      explainView.zoomFolders,
    )
  }, [explainView, explaining, mapLayoutForView])
  const mapSelectedId = explaining ? (explainView?.select ?? null) : selectedId
  const mapImportedBy = explaining ? Boolean(explainView?.importedBy) : importedBy
  const mapSelectedFolder = explaining ? null : selectedFolder
  const explainFile = explaining ? explainInfoFile(explainStep, displayGraph) : null

  const replaceVisibleColors = useCallback((next: string[]) => {
    visibleBlueprintColorsRef.current = next
    setVisibleBlueprintColors(next)
  }, [])

  const currentVisibleColors = useCallback(
    () => visibleBlueprintColorsRef.current,
    [],
  )

  const replaceStoredBlueprints = useCallback(
    (next: { global: SharedBlueprint; locals: LocalBlueprint[] }) => {
      latestBlueprintsRef.current = next
      setGlobalBlueprint(next.global)
      setLocalBlueprints(next.locals)
    },
    [],
  )

  const applyHiddenToColors = useCallback(
    (colors: string[], hidden: boolean) => {
      if (colors.length === 0) return
      blueprintPersistGen.current += 1
      for (const color of colors) {
        if (color === blueprintColorRef.current) {
          blueprintHiddenRef.current = hidden
          setBlueprintHidden(hidden)
          rememberLiveBlueprint(color, { hidden })
        } else {
          replaceStoredBlueprints(
            withBlueprintHidden(
              latestBlueprintsRef.current,
              color,
              hidden,
              blueprintOptionsRef.current,
            ),
          )
        }
        void persistBlueprintHidden(hidden, color)
      }
      const visible = visibleBlueprintColorsRef.current
      if (hidden) {
        replaceVisibleColors(visible.filter((id) => !colors.includes(id)))
      } else {
        const next = [...visible]
        for (const color of colors) {
          if (!next.includes(color)) next.push(color)
        }
        replaceVisibleColors(next)
      }
    },
    [rememberLiveBlueprint, replaceStoredBlueprints, replaceVisibleColors],
  )

  const activateBlueprintColor = useCallback(
    (color: string) => {
      if (color === blueprintColorRef.current) return
      persistBlueprint()
      blueprintColorRef.current = color
      setBlueprintColor(color)
      applyBlueprintContents(
        blueprintForColor(
          color,
          latestBlueprintsRef.current.global,
          latestBlueprintsRef.current.locals,
        ),
        false,
      )
    },
    [applyBlueprintContents, persistBlueprint],
  )

  const selectBlueprintColor = useCallback(
    (color: string) => {
      if (!currentVisibleColors().includes(color)) {
        applyHiddenToColors([color], false)
      }
      activateBlueprintColor(color)
    },
    [activateBlueprintColor, applyHiddenToColors, currentVisibleColors],
  )
  selectBlueprintColorRef.current = selectBlueprintColor

  const writeCreatedContents = useCallback(
    (
      color: string,
      next: {
        blocks: UserCreatedBlock[]
        islands: UserCreatedIsland[]
        functions: PatchSymbolAddition[]
        variables: PatchSymbolAddition[]
        imports: PatchImportAddition[]
        notes: BlueprintNote[]
        pointers: BlueprintPointer[]
      },
    ) => {
      if (color === blueprintColorRef.current) {
        setUserBlocks(next.blocks)
        setUserIslands(next.islands)
      }
      persistBlueprint(
        next.blocks,
        next.islands,
        next.functions,
        next.variables,
        next.imports,
        next.notes,
        next.pointers,
        color,
      )
    },
    [persistBlueprint],
  )

  const commitAddItem = useCallback(
    (name: string, requestedColor: string) => {
      if (!addingItem) return false
      const color = addingItem.lockedColor ?? requestedColor
      const stored = createdContentsForColor(color)
      if (addingItem.kind === 'file') {
        const resolved = resolveCreatedFile(name, addingItem.parent)
        if (!resolved) return false
        if (stored.blocks.some((block) => block.id === resolved.id)) return false
        const shown = new Set(
          displayGraph.files
            .filter((file) => file.folder === addingItem.parent)
            .map((file) => file.id),
        )
        let fileIndex = shown.size
        for (const block of stored.blocks) {
          if (block.folder === addingItem.parent && !shown.has(block.id)) {
            fileIndex += 1
          }
        }
        const spot = defaultBlockSpot(
          placementLayoutRef.current ?? layout,
          addingItem.parent,
          fileIndex,
        )
        if (!spot) return false
        writeCreatedContents(color, {
          ...stored,
          blocks: [...stored.blocks, { ...resolved, x: spot.x, z: spot.z }],
        })
      } else {
        const resolved = resolveCreatedIsland(name, addingItem.parent)
        if (!resolved) return false
        if (
          stored.islands.some(
            (island) =>
              island.path === resolved.path || island.id === resolved.id,
          )
        ) {
          return false
        }
        writeCreatedContents(color, {
          ...stored,
          islands: [...stored.islands, resolved],
        })
      }
      if (!visibleBlueprintColorsRef.current.includes(color)) {
        applyHiddenToColors([color], false)
      }
      setAddingItem(null)
      return true
    },
    [
      addingItem,
      applyHiddenToColors,
      createdContentsForColor,
      displayGraph.files,
      layout,
      writeCreatedContents,
    ],
  )

  const toggleBlueprintColor = useCallback(
    (color: string) => {
      const visible = currentVisibleColors()
      if (visible.includes(color)) {
        applyHiddenToColors([color], true)
        const remaining = visible.filter((id) => id !== color)
        if (color === blueprintColorRef.current && remaining.length > 0) {
          activateBlueprintColor(remaining[remaining.length - 1]!)
        }
        return
      }
      selectBlueprintColor(color)
    },
    [
      activateBlueprintColor,
      applyHiddenToColors,
      currentVisibleColors,
      selectBlueprintColor,
    ],
  )

  const clearSharedBlueprint = useCallback(() => {
    const colors = currentVisibleColors()
    if (colors.length === 0) return
    blueprintPersistGen.current += 1
    for (const color of colors) {
      if (color === blueprintColorRef.current) {
        setUserBlocks([])
        setUserIslands([])
        setBlueprintFunctions([])
        setBlueprintVariables([])
        setBlueprintImports([])
        blueprintNotesRef.current = []
        blueprintPointersRef.current = []
        setBlueprintNotes([])
        setBlueprintPointers([])
        rememberLiveBlueprint(color, {
          blocks: [],
          islands: [],
          functions: [],
          variables: [],
          imports: [],
          notes: [],
          pointers: [],
        })
      } else {
        replaceStoredBlueprints(
          withPatchedBlueprint(
            latestBlueprintsRef.current,
            color,
            emptiedBlueprint,
          ),
        )
      }
      void persistBlueprintClear(color)
    }
  }, [currentVisibleColors, rememberLiveBlueprint, replaceStoredBlueprints])

  const cleanupSharedBlueprint = useCallback(() => {
    const colors = currentVisibleColors()
    if (colors.length === 0) return
    blueprintPersistGen.current += 1
    const files = knownFileIds
    const folders = knownFolderPaths
    for (const color of colors) {
      if (color === blueprintColorRef.current) {
        const source = createdContentsForColor(color)
        const nextBlocks = source.blocks.filter(
          (block) => block.naming || !files.has(block.id),
        )
        const nextIslands = source.islands.filter(
          (island) => island.naming || !folders.has(island.path),
        )
        const removed = new Set(
          source.blocks
            .filter((block) => !block.naming && files.has(block.id))
            .map((block) => block.id),
        )
        const nextFunctions = source.functions.filter(
          (item) => !removed.has(item.file),
        )
        const nextVariables = source.variables.filter(
          (item) => !removed.has(item.file),
        )
        const nextImports = source.imports.filter(
          (item) => !removed.has(item.file),
        )
        const notes = dropBlueprintFileNotes(source.notes, removed)
        blueprintNotesRef.current = notes
        setUserBlocks(nextBlocks)
        setUserIslands(nextIslands)
        setBlueprintFunctions(nextFunctions)
        setBlueprintVariables(nextVariables)
        setBlueprintImports(nextImports)
        setBlueprintNotes(notes)
        rememberLiveBlueprint(color, {
          blocks: nextBlocks,
          islands: nextIslands,
          functions: nextFunctions,
          variables: nextVariables,
          imports: nextImports,
          notes,
        })
      } else {
        replaceStoredBlueprints(
          withPatchedBlueprint(latestBlueprintsRef.current, color, (blueprint) =>
            cleanedBlueprint(blueprint, files, folders),
          ),
        )
      }
      void persistBlueprintCleanup(color)
    }
  }, [
    createdContentsForColor,
    currentVisibleColors,
    knownFileIds,
    knownFolderPaths,
    rememberLiveBlueprint,
    replaceStoredBlueprints,
  ])

  return (
    <>
      <div className={explaining ? 'stage stage-explain' : 'stage'}>
        <CanvasErrorBoundary>
        <Canvas
          shadows={false}
          dpr={[1, 1.5]}
          gl={{ antialias: true, toneMappingExposure: 1.25 }}
          onCreated={({ gl }) => {
            gl.domElement.addEventListener(
              'webglcontextlost',
              (event) => event.preventDefault(),
              { once: false },
            )
          }}
          camera={{
            position: layout.spawn,
            fov: 70,
            near: 0.1,
            far: 400,
          }}
        >
          <World
            graph={displayGraph}
            layout={layout}
            mode={mode}
            landAt={landAt}
            selectedId={mapSelectedId}
            selectedFolder={mapSelectedFolder}
            selectedFolderLayer={explaining ? null : selectedFolderLayer}
            locked={locked}
            onSelect={explaining ? () => {} : selectFile}
            onSelectFolder={explaining ? () => {} : selectFolder}
            pickingImport={Boolean(importPickFrom)}
            onLockedChange={setLocked}
            onLand={landFromMap}
            onWalkPosition={rememberWalk}
            onContext={persistUserContext}
            plannedIds={plannedIds}
            previewFiles={{}}
            plannedImports={plannedImports}
            createdIds={plannedCreates}
            deletedIds={deletedIds}
            createLines={changeSet.createLines ?? {}}
            flyTo={flyTo}
            aimedRelation={aimedRelation}
            onAimRelation={setAimedRelation}
            onAimFile={setAimedFileId}
            onInspect={inspectBlock}
            onTravelTo={flyAlongRelation}
            importedBy={mapImportedBy}
            relationMode={relationMode}
            namingId={namingId}
            namingIslandId={namingIslandId}
            onBlueprintMenu={
              canPlace && !explaining ? setMapMenu : undefined
            }
            userCreatedBlocks={mapBlueprint.blocks}
            userCreatedIslands={mapBlueprint.islands}
            overlayLayers={overlayLayers}
            overlayOpacity={blueprintOpacity}
            pointedFileIds={Object.keys(pointedColors.files)}
            pointedFileColors={pointedColors.files}
            pointedFolderPaths={Object.keys(pointedColors.folders)}
            pointedFolderColors={pointedColors.folders}
            mapGraph={
              explaining
                ? null
                : changePathsOnly && hasChangeSet
                  ? changePathGraph
                  : null
            }
            mapLayout={
              explaining
                ? null
                : changePathsOnly && hasChangeSet
                  ? changePathLayout
                  : null
            }
            explainActive={explaining}
            explainFocus={explainView}
            focusBounds={explainBounds}
            focusFlightKey={explaining ? explain.currentStep : 0}
            landEnabled={!explaining}
          />
        </Canvas>
        </CanvasErrorBoundary>
      </div>
      {cardExplain ? (
        <ExplainAskCard explain={explain} onClose={closeAskCard} />
      ) : null}
      {explaining ? (
        <>
          <ExplainHud
            explain={explain}
            onStep={goExplainStep}
            onExit={exitExplain}
          />
          {explainFile && explainStep ? (
            <>
              <ExplainInfoPanel
                file={explainFile}
                highlights={explainStep.highlights}
                point={explainStep.point}
              />
              <ExplainPointer stepKey={explain.currentStep} />
            </>
          ) : null}
        </>
      ) : (
      <HUD
        graph={displayGraph}
        mode={mode}
        locked={locked}
        selectedId={selectedId}
        selectedTick={selectedTick}
        inspectTick={inspectTick}
        selectedFolder={selectedFolder}
        selectedFolderLayer={selectedFolderLayer}
        overlayLayers={overlayLayers}
        canDeleteSelected={canDeleteSelected}
        onSelectFolder={selectFolder}
        aimedRelation={aimedRelation}
        aimedFileId={aimedFileId}
        intent={intent}
        intents={intents}
        focusedSessionId={focusedSessionId}
        nextAttachSessionId={nextAttachSessionId}
        onFocusSession={focusSessionPanel}
        onWorkflowAction={runWorkflowAction}
        onNavigateDiff={navigateDiff}
        onOpenMap={openMap}
        onWalk={openWalk}
        showBranchChanges={showingBranchChanges}
        branchChanges={branchChanges}
        canShowBranchChanges={canToggleBranchChanges}
        llmMakingChanges={llmBusy}
        onToggleShowBranchChanges={toggleShowBranchChanges}
        onUpdateModel={onUpdateModel}
        updatingModel={updatingModel}
        importedBy={importedBy}
        onToggleImportedBy={toggleImportedBy}
        relationMode={relationMode}
        onRelationModeChange={setRelationModeAndClearAim}
        changePathsOnly={changePathsOnly}
        hasChangeSet={hasChangeSet}
        onToggleChangePathsOnly={toggleChangePathsOnly}
        naming={Boolean(addingItem)}
        addingKind={addingItem?.kind ?? null}
        addingParent={addingItem?.parent ?? null}
        addingLockedColor={addingItem?.lockedColor ?? null}
        onCommitAdd={commitAddItem}
        onCancelAdd={() => setAddingItem(null)}
        blueprintFunctions={blueprintFunctions}
        blueprintVariables={blueprintVariables}
        blueprintImports={blueprintImports}
        blueprintNotes={blueprintNotes}
        blueprintPointers={blueprintPointers}
        onAddBlueprintFunction={addBlueprintFunction}
        onAddBlueprintVariable={addBlueprintVariable}
        onAddBlueprintImport={addBlueprintImport}
        importPickActive={Boolean(importPickFrom)}
        onToggleImportPick={toggleImportPick}
        onCancelImportPick={cancelImportPick}
        onRemoveBlueprintFunction={removeBlueprintFunction}
        onRemoveBlueprintVariable={removeBlueprintVariable}
        onRemoveBlueprintImport={removeBlueprintImport}
        onSetBlueprintNote={applyBlueprintNote}
        onToggleBlueprintPointer={applyBlueprintPointer}
        onMapAddFile={beginAddFile}
        onMapAddFolder={beginAddFolder}
        onRenameCreatedFile={renameCreatedBlock}
        onInspectFile={inspectFile}
        onInspectBlock={inspectBlock}
        onExplainTarget={canAskLlm ? startExplainTarget : undefined}
        blueprintOpacity={blueprintOpacity}
        onBlueprintOpacityChange={setBlueprintOpacity}
        blueprintHasContent={blueprintHasContent}
        blueprintCanCleanup={blueprintCanCleanup}
        blueprintColor={blueprintColor}
        blueprintColors={visibleBlueprintColors}
        blueprintOptions={blueprintOptions}
        blueprintColorPointers={blueprintColorPointers}
        onSelectBlueprintColor={selectBlueprintColor}
        onToggleBlueprintColor={toggleBlueprintColor}
        onClearBlueprint={clearSharedBlueprint}
        onCleanupBlueprint={cleanupSharedBlueprint}
        devTargets={devTargets}
        onSelectDevTarget={onSelectDevTarget}
      />
      )}
      {!explaining && (
      <MapContextMenu
        menu={mapMenu}
        pointed={
          mapMenu
            ? findBlueprintPointer(blueprintPointers, 'folder', mapMenu.folder)
            : false
        }
        onAddFile={beginAddFile}
        onAddFolder={beginAddFolder}
        onPointToFolder={(folder) =>
          applyBlueprintPointer({ kind: 'folder', path: folder })
        }
        onClose={() => setMapMenu(null)}
      />
      )}
    </>
  )
}
