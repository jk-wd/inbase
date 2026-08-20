import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import codebase from './data/codebase.json'
import { emptyIntent, fetchAgentIntent, performAgentAction, persistSessionBlueprint } from './agentIntent'
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

const graph = codebase as CodebaseGraph

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
  const [intent, setIntent] = useState<AgentIntent>(emptyIntent)
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
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [aimedRelation, setAimedRelation] = useState<AimedRelation | null>(null)
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null)
  const [locked, setLocked] = useState(false)
  const [currentFolder, setCurrentFolder] = useState(graph.targetName)
  const [followLook, setFollowLook] = useState(false)
  const [importedBy, setImportedBy] = useState(false)
  const lastIntentSig = useRef<string | null>(null)
  const viewedDiffId = useRef<string | null>(null)
  const browsingHistory = useRef(false)

  const applyIntent = useCallback((next: AgentIntent) => {
    setIntent(next)
    viewedDiffId.current = next.diffId
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
      action: WorkflowAction,
      options: { instruction?: string; step?: number } = {},
    ) => {
      if (!intent.sessionId) return
      if (
        (action === 'continue' || action === 'instruct') &&
        (!intent.diffId || !intent.isActiveDiff)
      ) {
        return
      }
      try {
        const next = await performAgentAction(
          action,
          intent.sessionId,
          {
            ...options,
            diffId: intent.diffId ?? undefined,
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
        browsingHistory.current = false
        lastIntentSig.current = intentSignature(next)
        applyIntent(next)
      } catch {
        // Keep the pending patch visible if apply failed.
      }
    },
    [
      applyIntent,
      blueprintFunctions,
      blueprintImports,
      blueprintVariables,
      intent.diffId,
      intent.isActiveDiff,
      intent.sessionId,
      userBlocks,
      userIslands,
    ],
  )

  const navigateDiff = useCallback(
    async (diffId: string) => {
      try {
        const latest = intent.chain.at(-1)?.id
        browsingHistory.current = diffId !== latest
        const next = await fetchAgentIntent(diffId)
        lastIntentSig.current = intentSignature(next)
        applyIntent(next)
      } catch {
        // Keep the current chain position if navigation failed.
      }
    },
    [applyIntent, intent.chain],
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
    if (!intent.sessionId) {
      setUserBlocks([])
      setUserIslands([])
      setBlueprintFunctions([])
      setBlueprintVariables([])
      setBlueprintImports([])
      return
    }
    const knownFiles = new Set(graph.files.map((file) => file.id))
    const knownFolders = new Set(graph.folders.map((folder) => folder.path))
    const nextBlocks = parseUserCreatedBlocks(intent.userCreatedBlocks).filter(
      (block) => !knownFiles.has(block.id),
    )
    const nextIslands = parseUserCreatedIslands(intent.userCreatedIslands).filter(
      (island) => !knownFolders.has(island.path),
    )
    if (intent.creationMode) {
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
        current.length > 0 ? current : intent.blueprintFunctions,
      )
      setBlueprintVariables((current) =>
        current.length > 0 ? current : intent.blueprintVariables,
      )
      setBlueprintImports((current) =>
        current.length > 0 ? current : intent.blueprintImports,
      )
      return
    }
    setUserBlocks(nextBlocks)
    setUserIslands(nextIslands)
    setBlueprintFunctions(intent.blueprintFunctions)
    setBlueprintVariables(intent.blueprintVariables)
    setBlueprintImports(intent.blueprintImports)
  }, [
    intent.blueprintFunctions,
    intent.blueprintImports,
    intent.blueprintVariables,
    intent.creationMode,
    intent.userCreatedBlocks,
    intent.userCreatedIslands,
  ])

  const persistBlueprint = useCallback(
    (
      blocks: UserCreatedBlock[] = userBlocks,
      islands: UserCreatedIsland[] = userIslands,
      functions: PatchSymbolAddition[] = blueprintFunctions,
      variables: PatchSymbolAddition[] = blueprintVariables,
      imports: PatchImportAddition[] = blueprintImports,
    ) => {
      if (!intent.sessionId || !intent.creationMode) return
      persistSessionBlueprint(intent.sessionId, {
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
      intent.creationMode,
      intent.sessionId,
      userBlocks,
      userIslands,
    ],
  )

  const placeBlock = useCallback(
    (spot: { x: number; z: number; folder: string }) => {
      if (!intent.creationMode) return
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
    [intent.creationMode],
  )

  const placeBlockOnFolder = useCallback(
    (folderPath: string) => {
      if (!intent.creationMode) return
      const fileCount = displayGraph.files.filter(
        (file) => file.folder === folderPath,
      ).length
      const spot = defaultBlockSpot(layout, folderPath, fileCount)
      if (!spot) return
      placeBlock(spot)
    },
    [displayGraph.files, intent.creationMode, layout, placeBlock],
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
    [persistBlueprint, userBlocks, userIslands],
  )

  const cancelBlockName = useCallback((id: string) => {
    setUserBlocks((current) => current.filter((block) => block.id !== id))
  }, [])

  const placeIsland = useCallback(
    (parent: string) => {
      if (!intent.creationMode) return
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
    [intent.creationMode],
  )

  const placeIslandOnFolder = useCallback(
    (parent: string) => {
      if (!intent.creationMode) return
      placeIsland(parent)
    },
    [intent.creationMode, placeIsland],
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
    [persistBlueprint, userBlocks, userIslands],
  )

  const cancelIslandName = useCallback((id: string) => {
    setUserIslands((current) => current.filter((island) => island.id !== id))
  }, [])

  const deleteSelectedCreatedBlock = useCallback(() => {
    if (!intent.creationMode || !selectedId) return false
    const selected = userBlocks.find((block) => block.id === selectedId)
    if (!selected || selected.naming) return false
    const next = userBlocks.filter((block) => block.id !== selectedId)
    setUserBlocks(next)
    persistBlueprint(next, userIslands)
    setSelectedId(null)
    return true
  }, [intent.creationMode, persistBlueprint, selectedId, userBlocks, userIslands])

  const selectFile = useCallback(
    (fileId: string | null) => {
      setSelectedId(fileId)
      if (fileId) setSelectedFolder(null)
      if (fileId && intent.creationMode) document.exitPointerLock()
    },
    [intent.creationMode],
  )

  const selectFolder = useCallback((folderPath: string | null) => {
    setSelectedFolder(folderPath)
    if (folderPath) setSelectedId(null)
  }, [])

  const addBlueprintFunction = useCallback(
    (fileId: string, rawName: string) => {
      if (!intent.creationMode || fileId.startsWith('draft:')) return false
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
      intent.creationMode,
      persistBlueprint,
      userBlocks,
      userIslands,
    ],
  )

  const addBlueprintVariable = useCallback(
    (fileId: string, rawName: string) => {
      if (!intent.creationMode || fileId.startsWith('draft:')) return false
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
      intent.creationMode,
      persistBlueprint,
      userBlocks,
      userIslands,
    ],
  )

  const addBlueprintImport = useCallback(
    (fileId: string, raw: string) => {
      if (!intent.creationMode || fileId.startsWith('draft:')) return false
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
      intent.creationMode,
      persistBlueprint,
      userBlocks,
      userIslands,
    ],
  )

  const removeBlueprintFunction = useCallback(
    (fileId: string, name: string) => {
      if (!intent.creationMode) return
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
      intent.creationMode,
      persistBlueprint,
      userBlocks,
      userIslands,
    ],
  )

  const removeBlueprintVariable = useCallback(
    (fileId: string, name: string) => {
      if (!intent.creationMode) return
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
      intent.creationMode,
      persistBlueprint,
      userBlocks,
      userIslands,
    ],
  )

  const removeBlueprintImport = useCallback(
    (fileId: string, name: string, from: string) => {
      if (!intent.creationMode) return
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
      intent.creationMode,
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
        const next = await fetchAgentIntent(
          browsingHistory.current ? viewedDiffId.current ?? undefined : undefined,
        )
        const signature = intentSignature(next)
        if (cancelled || signature === lastIntentSig.current) {
          return
        }
        lastIntentSig.current = signature
        applyIntent(next)
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
  }, [applyIntent])

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
            onPlaceBlock={intent.creationMode ? placeBlock : undefined}
            onPlaceIsland={intent.creationMode ? placeIsland : undefined}
            onCommitName={commitBlockName}
            onCancelName={cancelBlockName}
            userCreatedBlocks={userBlocks}
            userCreatedIslands={userIslands}
          />
        </Canvas>
      </div>
      <HUD
        graph={displayGraph}
        mode={mode}
        locked={locked}
        selectedId={selectedId}
        selectedFolder={selectedFolder}
        aimedRelation={aimedRelation}
        currentFolder={currentFolder}
        intent={intent}
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
      />
    </>
  )
}
