import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { emptyIntent, fetchAgentIntent, fetchAgentIntents, inspectTargetFile, performAgentAction, persistSessionBlueprint } from './agentIntent'
import { fetchCodebase } from './codebase'
import {
  layoutWorld,
  markCreatedFolders,
  standInFront,
  relationTravelTarget,
  withPreviewGraph,
} from './layout'
import { World } from './scene/World'
import { HUD } from './ui/HUD'
import {
  fetchUserContext,
  persistFollowLook,
  persistUserContext,
} from './userContext'
import {
  defaultBlockSpot,
  isBlueprintSymbolName,
  namedCreatedBlocks,
  namedCreatedIslands,
  parseBlueprintImport,
  parseUserCreatedBlocks,
  parseUserCreatedIslands,
  resolveCreatedFile,
  resolveCreatedIsland,
  withBlueprintIntent,
  withUserCreatedGraph,
  withUserCreatedLayout,
} from './userCreated'
import {
  isPatchPreview,
  type AgentIntent,
  type AimedRelation,
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
    sessionId: intent.sessionId,
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
  })
}

export default function App() {
  const [graph, setGraph] = useState<CodebaseGraph | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refreshGraph = useCallback(async () => {
    const next = await fetchCodebase()
    if (next) {
      setGraph(next)
      setLoadError(null)
      return
    }
    setLoadError((current) => current ?? 'Could not load the project map.')
  }, [])

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

  return <Explorer graph={graph} onRefreshGraph={refreshGraph} />
}

function Explorer({
  graph,
  onRefreshGraph,
}: {
  graph: CodebaseGraph
  onRefreshGraph: () => Promise<void>
}) {
  const [intents, setIntents] = useState<AgentIntent[]>([])
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null)
  const intent =
    intents.find((item) => item.sessionId === focusedSessionId) ??
    intents[0] ??
    emptyIntent
  const creationIntent =
    intents.find((item) => item.creationMode) ??
    intents.find((item) => item.status === 'blueprint') ??
    null
  const creationMode = Boolean(creationIntent?.creationMode)
  const previewing = intent.preview || isPatchPreview(intent.status)
  const plannedCreates = previewing ? intent.creates : []
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
  const namingId = userBlocks.find((block) => block.naming)?.id ?? null
  const namingIslandId = userIslands.find((island) => island.naming)?.id ?? null
  const naming = Boolean(namingId || namingIslandId)
  const previewGraph = useMemo(() => {
    if (!previewing) return graph
    return withPreviewGraph(
      graph,
      plannedCreates,
      intent.createLines ?? {},
      intent.createFolders ?? [],
      intent.imports ?? [],
    )
  }, [
    graph,
    intent.createFolders,
    intent.createLines,
    intent.imports,
    plannedCreates,
    previewing,
  ])
  const displayGraph = useMemo(
    () =>
      withBlueprintIntent(
        withUserCreatedGraph(previewGraph, userBlocks, userIslands),
        blueprintFunctions,
        blueprintVariables,
        blueprintImports,
      ),
    [
      blueprintFunctions,
      blueprintImports,
      blueprintVariables,
      previewGraph,
      userBlocks,
      userIslands,
    ],
  )
  const layout = useMemo(() => {
    const world = layoutWorld(previewGraph)
    if (previewing) markCreatedFolders(world, intent.createFolders ?? [])
    return withUserCreatedLayout(world, userBlocks, userIslands)
  }, [intent.createFolders, previewGraph, previewing, userBlocks, userIslands])
  const [mode, setMode] = useState<ViewMode>('map')
  const [landAt, setLandAt] = useState<[number, number]>([
    layout.spawn[0],
    layout.spawn[2],
  ])
  const walkPos = useRef<[number, number]>([layout.spawn[0], layout.spawn[2]])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedTick, setSelectedTick] = useState(0)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [aimedRelation, setAimedRelation] = useState<AimedRelation | null>(null)
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null)
  const [locked, setLocked] = useState(false)
  const [currentFolder, setCurrentFolder] = useState(graph.targetName)
  const [followLook, setFollowLook] = useState(false)
  const [importedBy, setImportedBy] = useState(false)
  const lastIntentSig = useRef<string | null>(null)
  const viewedDiffId = useRef<Record<string, string | null>>({})
  const browsingHistory = useRef<Record<string, boolean>>({})

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

  const travelToFile = useCallback(
    (fileId: string, fly: boolean) => {
      const placed = layout.files[fileId]
      if (!placed) return
      const [x, z] = standInFront(placed)
      walkPos.current = [x, z]
      setAimedRelation(null)
      setLandAt([x, z])
      setFlyTo(
        fly
          ? {
              nonce: Date.now(),
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
      const [x, z] = walkPos.current
      travelToFile(relationTravelTarget(fromId, toId, x, z, layout.files), true)
    },
    [layout.files, travelToFile],
  )

  const runWorkflowAction = useCallback(
    async (
      sessionId: string,
      action: WorkflowAction,
      options: { instruction?: string; step?: number } = {},
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
                }
              : {}),
          },
        )
        browsingHistory.current[sessionId] = false
        lastIntentSig.current = null
        applyIntent(next, sessionId)
        if (action === 'invoke' || action === 'continue' || action === 'stop') {
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
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!creationIntent?.sessionId) {
      setUserBlocks([])
      setUserIslands([])
      setBlueprintFunctions([])
      setBlueprintVariables([])
      setBlueprintImports([])
      return
    }
    const knownFiles = new Set(graph.files.map((file) => file.id))
    const knownFolders = new Set(graph.folders.map((folder) => folder.path))
    const nextBlocks = parseUserCreatedBlocks(creationIntent.userCreatedBlocks).filter(
      (block) => !knownFiles.has(block.id),
    )
    const nextIslands = parseUserCreatedIslands(creationIntent.userCreatedIslands).filter(
      (island) => !knownFolders.has(island.path),
    )
    if (creationIntent.creationMode) {
      setUserBlocks((current) =>
        current.some((block) => block.naming) || current.length > 0
          ? current
          : nextBlocks,
      )
      setUserIslands((current) =>
        current.some((island) => island.naming) || current.length > 0
          ? current
          : nextIslands,
      )
      setBlueprintFunctions((current) =>
        current.length > 0 ? current : creationIntent.blueprintFunctions,
      )
      setBlueprintVariables((current) =>
        current.length > 0 ? current : creationIntent.blueprintVariables,
      )
      setBlueprintImports((current) =>
        current.length > 0 ? current : creationIntent.blueprintImports,
      )
      return
    }
    setUserBlocks(nextBlocks)
    setUserIslands(nextIslands)
    setBlueprintFunctions(creationIntent.blueprintFunctions)
    setBlueprintVariables(creationIntent.blueprintVariables)
    setBlueprintImports(creationIntent.blueprintImports)
  }, [
    creationIntent?.blueprintFunctions,
    creationIntent?.blueprintImports,
    creationIntent?.blueprintVariables,
    creationIntent?.creationMode,
    creationIntent?.sessionId,
    creationIntent?.userCreatedBlocks,
    creationIntent?.userCreatedIslands,
    graph,
  ])

  const persistBlueprint = useCallback(
    (
      blocks: UserCreatedBlock[] = userBlocks,
      islands: UserCreatedIsland[] = userIslands,
      functions: PatchSymbolAddition[] = blueprintFunctions,
      variables: PatchSymbolAddition[] = blueprintVariables,
      imports: PatchImportAddition[] = blueprintImports,
    ) => {
      if (!creationIntent?.sessionId || !creationIntent.creationMode) return
      persistSessionBlueprint(creationIntent.sessionId, {
        userCreatedBlocks: namedCreatedBlocks(blocks),
        userCreatedIslands: namedCreatedIslands(islands),
        addedFunctions: functions,
        addedVariables: variables,
        addedImports: imports,
      })
    },
    [
      blueprintFunctions,
      blueprintImports,
      blueprintVariables,
      creationIntent?.creationMode,
      creationIntent?.sessionId,
      userBlocks,
      userIslands,
    ],
  )

  const placeBlock = useCallback(
    (spot: { x: number; z: number; folder: string }) => {
      if (!creationMode) return
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
    [creationMode],
  )

  const placeBlockOnFolder = useCallback(
    (folderPath: string) => {
      if (!creationMode) return
      const fileCount = displayGraph.files.filter(
        (file) => file.folder === folderPath,
      ).length
      const spot = defaultBlockSpot(layout, folderPath, fileCount)
      if (!spot) return
      placeBlock(spot)
    },
    [displayGraph.files, creationMode, layout, placeBlock],
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
      if (!creationMode) return
      setUserIslands((current) => {
        if (current.some((island) => island.naming)) return current
        return [
          ...current,
          {
            id: `draft:${Date.now()}`,
            name: '',
            path: '',
            parent,
            naming: true,
          },
        ]
      })
      document.exitPointerLock()
    },
    [creationMode],
  )

  const placeIslandOnFolder = useCallback(
    (parent: string) => {
      if (!creationMode) return
      placeIsland(parent)
    },
    [creationMode, placeIsland],
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
      return true
    },
    [graph.folders, persistBlueprint, userBlocks, userIslands],
  )

  const cancelIslandName = useCallback((id: string) => {
    setUserIslands((current) => current.filter((island) => island.id !== id))
  }, [])

  const deleteSelectedCreatedBlock = useCallback(() => {
    if (!creationMode || !selectedId) return false
    const selected = userBlocks.find((block) => block.id === selectedId)
    if (!selected || selected.naming) return false
    const next = userBlocks.filter((block) => block.id !== selectedId)
    setUserBlocks(next)
    persistBlueprint(next, userIslands)
    setSelectedId(null)
    return true
  }, [creationMode, persistBlueprint, selectedId, userBlocks, userIslands])

  const selectFile = useCallback(
    (fileId: string | null) => {
      setSelectedId(fileId)
      if (fileId) {
        setSelectedFolder(null)
        setSelectedTick((tick) => tick + 1)
      }
      if (fileId && creationMode) document.exitPointerLock()
    },
    [creationMode],
  )

  const selectFolder = useCallback((folderPath: string | null) => {
    setSelectedFolder(folderPath)
    if (folderPath) setSelectedId(null)
  }, [])

  const addBlueprintFunction = useCallback(
    (fileId: string, rawName: string) => {
      if (!creationMode || fileId.startsWith('draft:')) return false
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
      creationMode,
      persistBlueprint,
      userBlocks,
      userIslands,
    ],
  )

  const addBlueprintVariable = useCallback(
    (fileId: string, rawName: string) => {
      if (!creationMode || fileId.startsWith('draft:')) return false
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
      creationMode,
      persistBlueprint,
      userBlocks,
      userIslands,
    ],
  )

  const addBlueprintImport = useCallback(
    (fileId: string, raw: string) => {
      if (!creationMode || fileId.startsWith('draft:')) return false
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
      creationMode,
      persistBlueprint,
      userBlocks,
      userIslands,
    ],
  )

  const removeBlueprintFunction = useCallback(
    (fileId: string, name: string) => {
      if (!creationMode) return
      const next = blueprintFunctions.filter(
        (item) => !(item.file === fileId && item.name === name),
      )
      setBlueprintFunctions(next)
      persistBlueprint(userBlocks, userIslands, next, blueprintVariables, blueprintImports)
    },
    [
      blueprintFunctions,
      blueprintImports,
      blueprintVariables,
      creationMode,
      persistBlueprint,
      userBlocks,
      userIslands,
    ],
  )

  const removeBlueprintVariable = useCallback(
    (fileId: string, name: string) => {
      if (!creationMode) return
      const next = blueprintVariables.filter(
        (item) => !(item.file === fileId && item.name === name),
      )
      setBlueprintVariables(next)
      persistBlueprint(userBlocks, userIslands, blueprintFunctions, next, blueprintImports)
    },
    [
      blueprintFunctions,
      blueprintImports,
      blueprintVariables,
      creationMode,
      persistBlueprint,
      userBlocks,
      userIslands,
    ],
  )

  const removeBlueprintImport = useCallback(
    (fileId: string, name: string, from: string) => {
      if (!creationMode) return
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
      creationMode,
      persistBlueprint,
      userBlocks,
      userIslands,
    ],
  )

  useEffect(() => {
    if (!namingId && !namingIslandId) return
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return
      event.preventDefault()
      if (namingId) cancelBlockName(namingId)
      if (namingIslandId) cancelIslandName(namingIslandId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancelBlockName, cancelIslandName, namingId, namingIslandId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'Backspace') return
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

  const toggleImportedBy = useCallback(() => {
    setImportedBy((current) => !current)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== 'KeyK') return
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
      toggleImportedBy()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleImportedBy])

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const bundle = await fetchAgentIntents()
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
        setFocusedSessionId((current) => {
          if (current && merged.some((item) => item.sessionId === current)) {
            return current
          }
          if (
            bundle.focusedSessionId &&
            merged.some((item) => item.sessionId === bundle.focusedSessionId)
          ) {
            return bundle.focusedSessionId
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
    }, 700)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const plannedIds = previewing ? [...intent.files, ...intent.creates] : []
  const blueprintImportEdges = blueprintImports.flatMap((item) => {
    if (!displayGraph.files.some((file) => file.id === item.from)) return []
    return [{ from: item.file, to: item.from }]
  })
  const plannedImports = [
    ...(previewing ? (intent.imports ?? []) : []),
    ...blueprintImportEdges,
  ]
  const deletedIds = previewing ? intent.deletes : []

  return (
    <>
      <div className="stage">
        <Canvas
          shadows={false}
          dpr={[1, 1.5]}
          gl={{ antialias: true, toneMappingExposure: 1.25 }}
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
            onFolderChange={setCurrentFolder}
            onLand={land}
            onWalkPosition={rememberWalk}
            onContext={persistUserContext}
            plannedIds={plannedIds}
            previewFiles={{}}
            plannedImports={plannedImports}
            createdIds={plannedCreates}
            deletedIds={deletedIds}
            createLines={intent.createLines ?? {}}
            flyTo={flyTo}
            aimedRelation={aimedRelation}
            onAimRelation={setAimedRelation}
            onTravelTo={flyAlongRelation}
            importedBy={importedBy}
            namingId={namingId}
            namingIslandId={namingIslandId}
            onPlaceBlock={creationMode ? placeBlock : undefined}
            onPlaceIsland={creationMode ? placeIsland : undefined}
            onCommitName={commitBlockName}
            onCancelName={cancelBlockName}
            userCreatedBlocks={userBlocks}
            userCreatedIslands={userIslands}
          />
        </Canvas>
      </div>
      <HUD
        graph={displayGraph}
        layout={layout}
        mode={mode}
        locked={locked}
        selectedId={selectedId}
        selectedTick={selectedTick}
        selectedFolder={selectedFolder}
        landAt={landAt}
        aimedRelation={aimedRelation}
        currentFolder={currentFolder}
        intent={intent}
        intents={intents}
        focusedSessionId={focusedSessionId}
        onFocusSession={setFocusedSessionId}
        onWorkflowAction={runWorkflowAction}
        onNavigateDiff={navigateDiff}
        onOpenMap={openMap}
        onWalk={openWalk}
        followLook={followLook}
        onToggleFollowLook={toggleFollowLook}
        importedBy={importedBy}
        onToggleImportedBy={toggleImportedBy}
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
        onAddBlueprintFunction={addBlueprintFunction}
        onAddBlueprintVariable={addBlueprintVariable}
        onAddBlueprintImport={addBlueprintImport}
        onRemoveBlueprintFunction={removeBlueprintFunction}
        onRemoveBlueprintVariable={removeBlueprintVariable}
        onRemoveBlueprintImport={removeBlueprintImport}
        onMapAddFile={placeBlockOnFolder}
        onMapAddFolder={placeIslandOnFolder}
        onInspectFile={inspectFile}
        plannedIds={plannedIds}
        createdIds={plannedCreates}
        deletedIds={deletedIds}
      />
    </>
  )
}
