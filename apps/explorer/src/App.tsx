import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { shouldIgnoreShortcut, isKeyboardIsolated } from './keyboard'
import { emptyIntent, fetchAgentIntent, fetchAgentIntents, inspectTargetFile, performAgentAction, persistBlueprintCleanup, persistBlueprintClear, persistBlueprintHidden, persistSessionBlueprint, persistSessionFocus, setupVisualizerSession } from './agentIntent'
import { emptyBranchChanges, fetchBranchChanges } from './branchChanges'
import { fetchCodebase, updateCodebase } from './codebase'
import {
  layoutWorld,
  markCreatedFolders,
  standInFront,
  relationTravelTarget,
  withPreviewGraph,
  filterGraphToChangePaths,
  mapPointOntoFolder,
} from './layout'
import { World } from './scene/World'
import { HUD } from './ui/HUD'
import { CanvasErrorBoundary } from './ui/CanvasErrorBoundary'
import {
  MapContextMenu,
  type MapContextMenuState,
} from './ui/MapContextMenu'
import {
  fetchUserContext,
  persistFollowLook,
  persistShowBranchChanges,
  persistUserContext,
} from './userContext'
import {
  defaultBlockSpot,
  dropBlueprintFileNotes,
  dropBlueprintFilePointers,
  dropBlueprintSymbolNote,
  dropBlueprintSymbolPointer,
  findBlueprintPointer,
  isBlueprintSymbolName,
  namedCreatedBlocks,
  namedCreatedIslands,
  parseBlueprintImport,
  parseBlueprintNotes,
  parseBlueprintPointers,
  parseUserCreatedBlocks,
  parseUserCreatedIslands,
  resolveCreatedFile,
  resolveCreatedIsland,
  setBlueprintNote,
  toggleBlueprintPointer,
  withBlueprintIntent,
  withUserCreatedGraph,
  withUserCreatedLayout,
} from './userCreated'
import {
  isPatchPreview,
  llmIsMakingChanges,
  type AgentIntent,
  type AimedRelation,
  type BlueprintNote,
  type BlueprintNoteKind,
  type BlueprintPointer,
  type BlueprintPointerKind,
  type CodebaseGraph,
  type FlyTo,
  type PatchImportAddition,
  type PatchSymbolAddition,
  type UserCreatedBlock,
  type UserCreatedIsland,
  type ViewMode,
  type WorkflowAction,
} from './types'

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
    applyGraph(await fetchCodebase(), 'Could not load the project map.')
  }, [applyGraph])

  const updateModel = useCallback(async () => {
    if (updatingModelRef.current) return
    updatingModelRef.current = true
    setUpdatingModel(true)
    try {
      applyGraph(await updateCodebase(), 'Could not update the project map.')
    } finally {
      updatingModelRef.current = false
      setUpdatingModel(false)
    }
  }, [applyGraph])

  useEffect(() => {
    void refreshGraph()
  }, [refreshGraph])

  if (!graph) {
    return (
      <div className="boot">
        <p>{loadError ?? 'Loading map…'}</p>
      </div>
    )
  }

  return (
    <Explorer
      graph={graph}
      onRefreshGraph={refreshGraph}
      onUpdateModel={updateModel}
      updatingModel={updatingModel}
    />
  )
}

function Explorer({
  graph,
  onRefreshGraph,
  onUpdateModel,
  updatingModel,
}: {
  graph: CodebaseGraph
  onRefreshGraph: () => Promise<void>
  onUpdateModel: () => Promise<void>
  updatingModel: boolean
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
  const userBlocksRef = useRef(userBlocks)
  const userIslandsRef = useRef(userIslands)
  const blueprintFunctionsRef = useRef(blueprintFunctions)
  const blueprintVariablesRef = useRef(blueprintVariables)
  const blueprintImportsRef = useRef(blueprintImports)
  const blueprintNotesRef = useRef(blueprintNotes)
  const blueprintPointersRef = useRef(blueprintPointers)
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
  const naming = Boolean(namingId || namingIslandId)
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
  const visibleBlocks = blueprintHidden
    ? userBlocks.filter((block) => block.naming)
    : userBlocks
  const visibleIslands = blueprintHidden
    ? userIslands.filter((island) => island.naming)
    : userIslands
  const pendingBlocks = visibleBlocks.filter(
    (block) => block.naming || !knownFileIds.has(block.id),
  )
  const overlayBlocks = visibleBlocks.filter(
    (block) => !block.naming && knownFileIds.has(block.id),
  )
  const displayGraph = useMemo(
    () =>
      withBlueprintIntent(
        withUserCreatedGraph(previewGraph, pendingBlocks, visibleIslands),
        blueprintFunctions,
        blueprintVariables,
        blueprintImports,
      ),
    [
      blueprintFunctions,
      blueprintImports,
      blueprintVariables,
      pendingBlocks,
      previewGraph,
      visibleIslands,
    ],
  )
  const layout = useMemo(() => {
    const world = layoutWorld(
      withUserCreatedGraph(previewGraph, [], visibleIslands),
    )
    if (previewing) markCreatedFolders(world, changeSet.createFolders ?? [])
    return withUserCreatedLayout(world, pendingBlocks, visibleIslands)
  }, [
    changeSet.createFolders,
    pendingBlocks,
    previewGraph,
    previewing,
    visibleIslands,
  ])
  const changeFileIds = useMemo(() => {
    const ids = new Set<string>()
    for (const id of changeSet.files) ids.add(id)
    for (const id of changeSet.creates) ids.add(id)
    for (const id of changeSet.deletes) ids.add(id)
    for (const block of userBlocks) ids.add(block.id)
    for (const item of blueprintFunctions) ids.add(item.file)
    for (const item of blueprintVariables) ids.add(item.file)
    for (const item of blueprintImports) ids.add(item.file)
    for (const note of blueprintNotes) ids.add(note.file)
    for (const pointer of blueprintPointers) {
      if (pointer.kind !== 'folder') ids.add(pointer.path)
    }
    return [...ids]
  }, [
    blueprintFunctions,
    blueprintImports,
    blueprintNotes,
    blueprintPointers,
    blueprintVariables,
    changeSet.creates,
    changeSet.deletes,
    changeSet.files,
    userBlocks,
  ])
  const changeFolderPaths = useMemo(() => {
    const paths = new Set<string>()
    for (const path of changeSet.createFolders ?? []) paths.add(path)
    for (const island of userIslands) {
      if (island.path) paths.add(island.path)
      else if (island.id) paths.add(island.id)
    }
    for (const pointer of blueprintPointers) {
      if (pointer.kind === 'folder') paths.add(pointer.path)
    }
    return [...paths]
  }, [blueprintPointers, changeSet.createFolders, userIslands])
  const hasChangeSet =
    changeFileIds.length > 0 || changeFolderPaths.length > 0
  const changePathGraph = useMemo(() => {
    if (!hasChangeSet) return displayGraph
    return filterGraphToChangePaths(
      displayGraph,
      changeFileIds,
      changeFolderPaths,
    )
  }, [changeFileIds, changeFolderPaths, displayGraph, hasChangeSet])
  const changePathLayout = useMemo(() => {
    if (!hasChangeSet) return layout
    const world = layoutWorld(changePathGraph)
    markCreatedFolders(world, [
      ...(changeSet.createFolders ?? []),
      ...userIslands.map((island) => island.path || island.id),
    ])
    return world
  }, [
    changePathGraph,
    changeSet.createFolders,
    hasChangeSet,
    layout,
    userIslands,
  ])
  const [mode, setMode] = useState<ViewMode>('map')
  const [landAt, setLandAt] = useState<[number, number]>([
    layout.spawn[0],
    layout.spawn[2],
  ])
  const walkPos = useRef<[number, number]>([layout.spawn[0], layout.spawn[2]])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedTick, setSelectedTick] = useState(0)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [mapMenu, setMapMenu] = useState<MapContextMenuState | null>(null)
  const [aimedRelation, setAimedRelation] = useState<AimedRelation | null>(null)
  const [aimedFileId, setAimedFileId] = useState<string | null>(null)
  const [inspectTick, setInspectTick] = useState(0)
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null)
  const [locked, setLocked] = useState(false)
  const [followLook, setFollowLook] = useState(false)
  const [importedBy, setImportedBy] = useState(false)
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

  const setupLlmSession = useCallback(async () => {
    const next = await setupVisualizerSession()
    lastIntentSig.current = null
    applyIntent(next, next.sessionId ?? undefined)
    if (next.sessionId) setFocusedSessionId(next.sessionId)
    return next
  }, [applyIntent])

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
    setMode('walk')
  }, [])

  const toggleMap = useCallback(() => {
    if (mode === 'walk') {
      setLandAt(walkPos.current)
      setFlyTo(null)
      setLocked(false)
      document.exitPointerLock()
      setMode('map')
      return
    }
    setMode('walk')
  }, [mode])

  const land = useCallback((x: number, z: number) => {
    walkPos.current = [x, z]
    setFlyTo(null)
    setLandAt([x, z])
    setMode('walk')
  }, [])

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
      options: { instruction?: string; step?: number; stepByStep?: boolean } = {},
    ) => {
      const current = intents.find((item) => item.sessionId === sessionId)
      if (!current?.sessionId) return
      if (
        (action === 'continue' || action === 'instruct') &&
        (!current.diffId || !current.isActiveDiff)
      ) {
        return
      }
      try {
        const next = await performAgentAction(
          action,
          current.sessionId,
          {
            ...options,
            diffId: current.diffId ?? undefined,
            ...(action === 'blueprint_send'
              ? {
                  userCreatedBlocks: namedCreatedBlocks(userBlocks),
                  userCreatedIslands: namedCreatedIslands(userIslands),
                  addedFunctions: blueprintFunctions,
                  addedVariables: blueprintVariables,
                  addedImports: blueprintImports,
                  notes: blueprintNotes,
                  pointers: blueprintPointers,
                }
              : {}),
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
      } catch {
        // Keep the pending patch visible if apply failed.
      }
    },
    [
      applyIntent,
      blueprintFunctions,
      blueprintImports,
      blueprintNotes,
      blueprintPointers,
      blueprintVariables,
      intents,
      onRefreshGraph,
      userBlocks,
      userIslands,
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
      if (typeof context?.followLook === 'boolean') {
        setFollowLook(context.followLook)
      }
      if (typeof context?.showBranchChanges === 'boolean') {
        setWantBranchChanges(context.showBranchChanges)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const persistBlueprint = useCallback(
    (
      blocks: UserCreatedBlock[] = userBlocksRef.current,
      islands: UserCreatedIsland[] = userIslandsRef.current,
      functions: PatchSymbolAddition[] = blueprintFunctionsRef.current,
      variables: PatchSymbolAddition[] = blueprintVariablesRef.current,
      imports: PatchImportAddition[] = blueprintImportsRef.current,
      notes: BlueprintNote[] = blueprintNotesRef.current,
      pointers: BlueprintPointer[] = blueprintPointersRef.current,
    ) => {
      if (notePersistTimer.current != null) {
        window.clearTimeout(notePersistTimer.current)
        notePersistTimer.current = null
      }
      const gen = ++blueprintPersistGen.current
      notesDirty.current = true
      void persistSessionBlueprint(intent.sessionId, {
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
      })
    },
    [intent.sessionId],
  )

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
    }) => {
      const pointers = toggleBlueprintPointer(blueprintPointersRef.current, next)
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

  const placeBlock = useCallback(
    (spot: { x: number; z: number; folder: string }) => {
      if (!canPlace) return
      setUserBlocks((current) => {
        if (current.some((block) => block.naming)) return current
        return [
          ...current,
          {
            id: `draft:${Date.now()}`,
            name: '',
            path: '',
            folder: spot.folder,
            x: spot.x,
            z: spot.z,
            naming: true,
          },
        ]
      })
      document.exitPointerLock()
    },
    [canPlace],
  )

  const placeBlockOnFolder = useCallback(
    (folderPath: string) => {
      if (!canPlace) return
      const fileCount = displayGraph.files.filter(
        (file) => file.folder === folderPath,
      ).length
      const spot = defaultBlockSpot(layout, folderPath, fileCount)
      if (!spot) return
      placeBlock(spot)
    },
    [displayGraph.files, canPlace, layout, placeBlock],
  )

  const commitBlockName = useCallback(
    (id: string, rawName: string) => {
      const draft = userBlocks.find((block) => block.id === id)
      if (!draft) return false
      const resolved = resolveCreatedFile(rawName, draft.folder)
      if (!resolved) return false
      const taken =
        graph.files.some((file) => file.id === resolved.id) ||
        userBlocks.some(
          (block) => block.id === resolved.id && block.id !== id,
        )
      if (taken) return false
      const next = userBlocks.map((block) =>
        block.id === id
          ? {
              ...resolved,
              x: draft.x,
              z: draft.z,
            }
          : block,
      )
      setUserBlocks(next)
      persistBlueprint(next, userIslands)
      return true
    },
    [graph.files, persistBlueprint, userBlocks, userIslands],
  )

  const cancelBlockName = useCallback((id: string) => {
    setUserBlocks((current) => current.filter((block) => block.id !== id))
  }, [])

  const placeIsland = useCallback(
    (parent: string) => {
      if (!canPlace) return
      let placedId: string | null = null
      setUserIslands((current) => {
        if (current.some((island) => island.naming)) return current
        placedId = `draft:${Date.now()}`
        return [
          ...current,
          {
            id: placedId,
            name: '',
            path: '',
            parent,
            naming: true,
          },
        ]
      })
      if (placedId) {
        setSelectedFolder(placedId)
        setSelectedId(null)
      }
      document.exitPointerLock()
    },
    [canPlace],
  )

  const placeIslandOnFolder = useCallback(
    (parent: string) => {
      if (!canPlace) return
      placeIsland(parent)
    },
    [canPlace, placeIsland],
  )

  const commitIslandName = useCallback(
    (id: string, rawName: string) => {
      const draft = userIslands.find((island) => island.id === id)
      if (!draft) return false
      const resolved = resolveCreatedIsland(rawName, draft.parent)
      if (!resolved) return false
      const taken =
        graph.folders.some((folder) => folder.path === resolved.path) ||
        userIslands.some(
          (island) => island.path === resolved.path && island.id !== id,
        )
      if (taken) return false
      const next = userIslands.map((island) =>
        island.id === id
          ? {
              ...resolved,
            }
          : island,
      )
      setUserIslands(next)
      persistBlueprint(userBlocks, next)
      setSelectedFolder(resolved.path)
      setSelectedId(null)
      return true
    },
    [graph.folders, persistBlueprint, userBlocks, userIslands],
  )

  const cancelIslandName = useCallback(
    (id: string) => {
      const draft = userIslands.find((island) => island.id === id)
      setUserIslands((current) => current.filter((island) => island.id !== id))
      setSelectedFolder((selected) =>
        selected === id ? draft?.parent ?? null : selected,
      )
    },
    [userIslands],
  )

  const deleteSelectedCreatedBlock = useCallback(() => {
    if (!canPlace || !selectedId) return false
    const selected = userBlocks.find((block) => block.id === selectedId)
    if (!selected || selected.naming) return false
    const next = userBlocks.filter((block) => block.id !== selectedId)
    const notes = dropBlueprintFileNotes(blueprintNotesRef.current, [selectedId])
    const pointers = dropBlueprintFilePointers(blueprintPointersRef.current, [
      selectedId,
    ])
    blueprintNotesRef.current = notes
    blueprintPointersRef.current = pointers
    setUserBlocks(next)
    setBlueprintNotes(notes)
    setBlueprintPointers(pointers)
    persistBlueprint(
      next,
      userIslands,
      undefined,
      undefined,
      undefined,
      notes,
      pointers,
    )
    setSelectedId(null)
    return true
  }, [canPlace, persistBlueprint, selectedId, userBlocks, userIslands])

  const selectFile = useCallback(
    (fileId: string | null) => {
      setSelectedId(fileId)
      if (fileId) {
        setSelectedFolder(null)
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

  const selectFolder = useCallback((folderPath: string | null) => {
    setSelectedFolder(folderPath)
    if (folderPath) setSelectedId(null)
  }, [])

  useEffect(() => {
    if (!changePathsOnly || !hasChangeSet) return
    if (selectedFolder && !changePathLayout.folders[selectedFolder]) {
      setSelectedFolder(null)
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
    if (!namingId && !namingIslandId) return
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return
      if (shouldIgnoreShortcut(event)) return
      event.preventDefault()
      if (namingId) cancelBlockName(namingId)
      if (namingIslandId) cancelIslandName(namingIslandId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancelBlockName, cancelIslandName, namingId, namingIslandId])

  useEffect(() => {
    if (mode !== 'map' || naming) setMapMenu(null)
  }, [mode, naming])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'Backspace') return
      if (shouldIgnoreShortcut(event)) return
      if (!deleteSelectedCreatedBlock()) return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleteSelectedCreatedBlock])

  const toggleFollowLook = useCallback(() => {
    setFollowLook((current) => {
      const next = !current
      persistFollowLook(next)
      return next
    })
  }, [])

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
    setImportedBy((current) => !current)
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

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const bundle = await fetchAgentIntents()
        if (cancelled) return
        setBlueprintHidden(Boolean(bundle.blueprint.hidden))
        const nextBlocks = parseUserCreatedBlocks(bundle.blueprint.userCreatedBlocks)
        const nextIslands = parseUserCreatedIslands(bundle.blueprint.userCreatedIslands)
        setUserBlocks((current) => {
          const drafts = current.filter((block) => block.naming)
          if (drafts.length === 0) return nextBlocks
          const namedIds = new Set(drafts.map((block) => block.id))
          return [...nextBlocks.filter((block) => !namedIds.has(block.id)), ...drafts]
        })
        setUserIslands((current) => {
          const drafts = current.filter((island) => island.naming)
          if (drafts.length === 0) return nextIslands
          const namedIds = new Set(drafts.map((island) => island.id))
          return [...nextIslands.filter((island) => !namedIds.has(island.id)), ...drafts]
        })
        setBlueprintFunctions(bundle.blueprint.addedFunctions)
        setBlueprintVariables(bundle.blueprint.addedVariables)
        setBlueprintImports(bundle.blueprint.addedImports)
        if (!notesDirty.current) {
          const nextPointers = parseBlueprintPointers(bundle.blueprint.pointers)
          blueprintPointersRef.current = nextPointers
          setBlueprintPointers(nextPointers)
        }
        if (!notesDirty.current && !isKeyboardIsolated()) {
          const nextNotes = parseBlueprintNotes(bundle.blueprint.notes)
          blueprintNotesRef.current = nextNotes
          setBlueprintNotes(nextNotes)
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
  }, [])

  const plannedIds = previewing ? [...changeSet.files, ...changeSet.creates] : []
  const blueprintImportEdges = blueprintImports.flatMap((item) => {
    if (!displayGraph.files.some((file) => file.id === item.from)) return []
    return [{ from: item.file, to: item.from }]
  })
  const plannedImports = [
    ...(previewing ? (changeSet.imports ?? []) : []),
    ...blueprintImportEdges,
  ]
  const deletedIds = previewing ? changeSet.deletes : []
  const blueprintHasContent =
    namedCreatedBlocks(userBlocks).length > 0 ||
    namedCreatedIslands(userIslands).length > 0 ||
    blueprintFunctions.length > 0 ||
    blueprintVariables.length > 0 ||
    blueprintImports.length > 0 ||
    blueprintNotes.length > 0 ||
    blueprintPointers.length > 0
  const blueprintCanCleanup =
    userBlocks.some((block) => !block.naming && knownFileIds.has(block.id)) ||
    userIslands.some(
      (island) => !island.naming && knownFolderPaths.has(island.path),
    )

  const toggleBlueprintHidden = useCallback(() => {
    const next = !blueprintHidden
    setBlueprintHidden(next)
    void persistBlueprintHidden(next).catch(() => setBlueprintHidden(!next))
  }, [blueprintHidden])

  const clearSharedBlueprint = useCallback(() => {
    setUserBlocks([])
    setUserIslands([])
    setBlueprintFunctions([])
    setBlueprintVariables([])
    setBlueprintImports([])
    blueprintNotesRef.current = []
    blueprintPointersRef.current = []
    setBlueprintNotes([])
    setBlueprintPointers([])
    void persistBlueprintClear()
  }, [])

  const cleanupSharedBlueprint = useCallback(() => {
    const files = knownFileIds
    const folders = knownFolderPaths
    const removed = new Set(
      userBlocks
        .filter((block) => !block.naming && files.has(block.id))
        .map((block) => block.id),
    )
    setUserBlocks((current) =>
      current.filter((block) => block.naming || !files.has(block.id)),
    )
    setUserIslands((current) =>
      current.filter((island) => island.naming || !folders.has(island.path)),
    )
    setBlueprintFunctions((current) =>
      current.filter((item) => !removed.has(item.file)),
    )
    setBlueprintVariables((current) =>
      current.filter((item) => !removed.has(item.file)),
    )
    setBlueprintImports((current) =>
      current.filter((item) => !removed.has(item.file)),
    )
    const notes = dropBlueprintFileNotes(blueprintNotesRef.current, removed)
    blueprintNotesRef.current = notes
    setBlueprintNotes(notes)
    void persistBlueprintCleanup()
  }, [knownFileIds, knownFolderPaths, userBlocks])

  return (
    <>
      <div className="stage">
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
            selectedId={selectedId}
            selectedFolder={selectedFolder}
            locked={locked}
            onSelect={selectFile}
            onSelectFolder={selectFolder}
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
            importedBy={importedBy}
            namingId={namingId}
            namingIslandId={namingIslandId}
            onPlaceBlock={canPlace ? placeBlock : undefined}
            onPlaceIsland={canPlace ? placeIsland : undefined}
            onBlueprintMenu={canPlace ? setMapMenu : undefined}
            onCommitName={commitBlockName}
            onCancelName={cancelBlockName}
            onCommitIslandName={commitIslandName}
            onCancelIslandName={cancelIslandName}
            userCreatedBlocks={visibleBlocks}
            userCreatedIslands={visibleIslands}
            overlayBlocks={overlayBlocks}
            pointedFileIds={
              blueprintHidden
                ? undefined
                : blueprintPointers.flatMap((item) =>
                    item.kind === 'folder' ? [] : [item.path],
                  )
            }
            pointedFolderPaths={
              blueprintHidden
                ? undefined
                : blueprintPointers.flatMap((item) =>
                    item.kind === 'folder' ? [item.path] : [],
                  )
            }
            mapGraph={
              changePathsOnly && hasChangeSet ? changePathGraph : null
            }
            mapLayout={
              changePathsOnly && hasChangeSet ? changePathLayout : null
            }
          />
        </Canvas>
        </CanvasErrorBoundary>
      </div>
      <HUD
        graph={displayGraph}
        layout={layout}
        mode={mode}
        locked={locked}
        selectedId={selectedId}
        selectedTick={selectedTick}
        inspectTick={inspectTick}
        selectedFolder={selectedFolder}
        landAt={landAt}
        aimedRelation={aimedRelation}
        aimedFileId={aimedFileId}
        intent={intent}
        intents={intents}
        focusedSessionId={focusedSessionId}
        nextAttachSessionId={nextAttachSessionId}
        onFocusSession={focusSessionPanel}
        onSetupSession={setupLlmSession}
        onWorkflowAction={runWorkflowAction}
        onNavigateDiff={navigateDiff}
        onOpenMap={openMap}
        onWalk={openWalk}
        followLook={followLook}
        onToggleFollowLook={toggleFollowLook}
        showBranchChanges={showingBranchChanges}
        branchChanges={branchChanges}
        canShowBranchChanges={canToggleBranchChanges}
        llmMakingChanges={llmBusy}
        onToggleShowBranchChanges={toggleShowBranchChanges}
        onUpdateModel={onUpdateModel}
        updatingModel={updatingModel}
        importedBy={importedBy}
        onToggleImportedBy={toggleImportedBy}
        changePathsOnly={changePathsOnly}
        hasChangeSet={hasChangeSet}
        onToggleChangePathsOnly={toggleChangePathsOnly}
        naming={naming}
        namingIsland={Boolean(namingIslandId)}
        onCommitIslandName={(name) => {
          if (namingIslandId) commitIslandName(namingIslandId, name)
        }}
        onCancelIslandName={() => {
          if (namingIslandId) cancelIslandName(namingIslandId)
        }}
        blueprintFunctions={blueprintFunctions}
        blueprintVariables={blueprintVariables}
        blueprintImports={blueprintImports}
        blueprintNotes={blueprintNotes}
        blueprintPointers={blueprintPointers}
        onAddBlueprintFunction={addBlueprintFunction}
        onAddBlueprintVariable={addBlueprintVariable}
        onAddBlueprintImport={addBlueprintImport}
        onRemoveBlueprintFunction={removeBlueprintFunction}
        onRemoveBlueprintVariable={removeBlueprintVariable}
        onRemoveBlueprintImport={removeBlueprintImport}
        onSetBlueprintNote={applyBlueprintNote}
        onToggleBlueprintPointer={applyBlueprintPointer}
        onMapAddFile={placeBlockOnFolder}
        onMapAddFolder={placeIslandOnFolder}
        onInspectFile={inspectFile}
        onInspectBlock={inspectBlock}
        plannedIds={plannedIds}
        createdIds={plannedCreates}
        deletedIds={deletedIds}
        blueprintHidden={blueprintHidden}
        blueprintHasContent={blueprintHasContent}
        blueprintCanCleanup={blueprintCanCleanup}
        onToggleBlueprintHidden={toggleBlueprintHidden}
        onClearBlueprint={clearSharedBlueprint}
        onCleanupBlueprint={cleanupSharedBlueprint}
      />
      <MapContextMenu
        menu={mapMenu}
        pointed={
          mapMenu
            ? findBlueprintPointer(blueprintPointers, 'folder', mapMenu.folder)
            : false
        }
        onAddFile={placeBlockOnFolder}
        onAddFolder={placeIslandOnFolder}
        onPointToFolder={(folder) =>
          applyBlueprintPointer({ kind: 'folder', path: folder })
        }
        onClose={() => setMapMenu(null)}
      />
    </>
  )
}
