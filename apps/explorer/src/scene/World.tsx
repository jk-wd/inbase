import { useMemo, useState } from 'react'
import { FolderArea } from './FolderArea'
import { FileBlock } from './FileBlock'
import { DistantFileBlocks } from './DistantFileBlocks'
import { Bridge } from './Bridge'
import { RelationLines } from './RelationLines'
import { Player } from './Player'
import { MapView, type MapBlueprintMenu, type MapFileLabel, type MapFocusBounds } from './MapView'
import { SelectionController } from './SelectionController'
import { UserContextTracker } from './UserContextTracker'
import { WalkLodTracker } from './WalkLodTracker'
import { computeWalkLod, type WalkLod } from './walkLod'
import {
  fileChangeKind,
  filesImporting,
  folderChangeHighlights,
  folderOfFile,
  mapPointOntoFolder,
} from '../layout'
import {
  explainFileFocused,
  explainFileHighlighted,
  explainFolderFocused,
  explainHasFocus,
  type ExplainFocus,
} from '../explain'
import { WORLD_VOID, CONFIG, fileHeight } from '../theme'
import type {
  CodebaseGraph,
  FileNode,
  FlyTo,
  AimedRelation,
  PatchImport,
  PlacedFile,
  UserContext,
  UserCreatedBlock,
  UserCreatedIsland,
  ViewMode,
  WorldLayout,
} from '../types'
import { toCreatedFile } from '../userCreated'

type WorldProps = {
  graph: CodebaseGraph
  layout: WorldLayout
  mode: ViewMode
  landAt: [number, number]
  selectedId: string | null
  selectedFolder?: string | null
  locked: boolean
  onSelect: (fileId: string | null) => void
  onSelectFolder: (folderPath: string | null) => void
  pickingImport?: boolean
  onLockedChange: (locked: boolean) => void
  onLand: (x: number, z: number) => void
  onWalkPosition: (x: number, z: number) => void
  onContext: (context: UserContext) => void
  plannedIds: string[]
  previewFiles: Record<string, PlacedFile>
  plannedImports: PatchImport[]
  createdIds: string[]
  deletedIds?: string[]
  createLines: Record<string, number>
  flyTo: FlyTo | null
  aimedRelation: AimedRelation | null
  onAimRelation: (aim: AimedRelation | null) => void
  onAimFile?: (fileId: string | null) => void
  onInspect?: (fileId: string) => void
  onTravelTo: (fromId: string, toId: string) => void
  importedBy?: boolean
  namingId?: string | null
  onBlueprintMenu?: (menu: MapBlueprintMenu) => void
  userCreatedBlocks?: UserCreatedBlock[]
  userCreatedIslands?: UserCreatedIsland[]
  overlayBlocks?: UserCreatedBlock[]
  pointedFileIds?: string[]
  pointedFileColors?: Record<string, string[]>
  pointedFolderPaths?: string[]
  pointedFolderColors?: Record<string, string[]>
  namingIslandId?: string | null
  mapGraph?: CodebaseGraph | null
  mapLayout?: WorldLayout | null
  explainActive?: boolean
  explainFocus?: ExplainFocus | null
  focusBounds?: MapFocusBounds | null
  focusFlightKey?: string | number
  landEnabled?: boolean
}

export function World({
  graph,
  layout,
  mode,
  landAt,
  selectedId,
  selectedFolder = null,
  locked,
  onSelect,
  onSelectFolder,
  pickingImport = false,
  onLockedChange,
  onLand,
  onWalkPosition,
  onContext,
  plannedIds,
  previewFiles,
  plannedImports,
  createdIds,
  deletedIds = [],
  createLines,
  flyTo,
  aimedRelation,
  onAimRelation,
  onAimFile,
  onInspect,
  onTravelTo,
  importedBy = false,
  namingId = null,
  namingIslandId = null,
  onBlueprintMenu,
  userCreatedBlocks = [],
  userCreatedIslands = [],
  overlayBlocks = [],
  pointedFileIds = [],
  pointedFileColors = {},
  pointedFolderPaths = [],
  pointedFolderColors = {},
  mapGraph = null,
  mapLayout = null,
  explainActive = false,
  explainFocus = null,
  focusBounds = null,
  focusFlightKey = 0,
  landEnabled = true,
}: WorldProps) {
  const created = new Set(createdIds)
  const deleted = new Set(deletedIds)
  const pointedFiles = new Set(pointedFileIds)
  const pointedFolders = new Set(pointedFolderPaths)
  const mapping = mode === 'map'
  const viewGraph = mapping && mapGraph ? mapGraph : graph
  const viewLayout = mapping && mapLayout ? mapLayout : layout
  const mapMarker =
    viewLayout === layout
      ? landAt
      : mapPointOntoFolder(landAt[0], landAt[1], layout, viewLayout)
  const placing = Boolean(namingId || namingIslandId)
  const planned = new Set(plannedIds)
  const ghosts = previewFiles
  const related = new Set(
    selectedId
      ? importedBy
        ? filesImporting(viewGraph.files, selectedId).map((file) => file.id)
        : (viewGraph.files.find((file) => file.id === selectedId)?.imports ?? [])
      : [],
  )
  const patchLinked = new Set<string>()
  for (const edge of plannedImports) {
    patchLinked.add(edge.from)
    patchLinked.add(edge.to)
    if (!planned.has(edge.to) && !deleted.has(edge.to)) related.add(edge.to)
    if (!planned.has(edge.from) && !deleted.has(edge.from)) related.add(edge.from)
  }
  const folderFileIds = new Set(
    selectedFolder
      ? (graph.folders.find((folder) => folder.path === selectedFolder)?.files ??
        [])
      : [],
  )
  const hasFocus =
    Boolean(selectedId) ||
    Boolean(selectedFolder) ||
    planned.size > 0 ||
    deleted.size > 0
  const highlightedFolders = folderChangeHighlights(
    planned,
    created,
    deleted,
    viewLayout.folders,
  )
  const ghostKey = Object.keys(ghosts).join('|')
  const keepFileIds = useMemo(() => {
    const ids = new Set<string>()
    if (selectedId) ids.add(selectedId)
    if (namingId) ids.add(namingId)
    if (aimedRelation?.flyTo) ids.add(aimedRelation.flyTo)
    for (const id of pointedFileIds) ids.add(id)
    if (ghostKey) {
      for (const id of ghostKey.split('|')) ids.add(id)
    }
    return ids
  }, [aimedRelation?.flyTo, ghostKey, namingId, pointedFileIds, selectedId])
  const keepFolderPaths = useMemo(() => {
    const paths = new Set<string>()
    if (selectedFolder) paths.add(selectedFolder)
    if (namingIslandId) paths.add(namingIslandId)
    for (const path of pointedFolderPaths) paths.add(path)
    return paths
  }, [namingIslandId, pointedFolderPaths, selectedFolder])
  const originLod = useMemo(() => {
    if (mapping) return null
    return computeWalkLod({
      x: landAt[0],
      z: landAt[1],
      lookX: 0,
      lookZ: 1,
      files: layout.files,
      folders: layout.folders,
      bridges: layout.bridges,
      keepFileIds,
      keepFolderPaths,
      prev: null,
    })
  }, [
    keepFileIds,
    keepFolderPaths,
    landAt,
    layout.bridges,
    layout.files,
    layout.folders,
    mapping,
  ])
  const landSig = `${landAt[0]},${landAt[1]}`
  const [lodLand, setLodLand] = useState(landSig)
  const [walkLod, setWalkLod] = useState<WalkLod | null>(null)
  if (lodLand !== landSig) {
    setLodLand(landSig)
    setWalkLod(null)
  }
  const lod = mapping ? null : (walkLod ?? originLod)
  const distantFiles: {
    file: FileNode
    placed: PlacedFile
    dimmed: boolean
  }[] = []
  const mapFileLabels = useMemo(() => {
    if (!mapping) return []
    const pointed = new Set(pointedFileIds)
    const seen = new Set<string>()
    const items: MapFileLabel[] = []
    const push = (id: string, name: string, placed: PlacedFile) => {
      if (!placed || seen.has(id)) return
      seen.add(id)
      const colors = pointedFileColors[id]
      items.push({
        id,
        name,
        x: placed.position[0],
        z: placed.position[2],
        width: placed.size[0],
        depth: placed.size[2],
        outer: -placed.aisleFace as 1 | -1,
        selected: id === selectedId,
        pointed: pointed.has(id),
        pointedColor: colors?.[colors.length - 1],
        dimmed:
          explainActive &&
          !explainFileFocused(explainFocus, id, folderOfFile(id)),
        focused: explainFileHighlighted(explainFocus, id, folderOfFile(id)),
      })
    }
    for (const file of viewGraph.files) {
      const placed = viewLayout.files[file.id]
      if (placed) push(file.id, file.name, placed)
    }
    for (const placed of Object.values(ghosts)) {
      push(placed.id, placed.id.split('/').pop() ?? placed.id, placed)
    }
    for (const block of overlayBlocks) {
      const height = fileHeight(12)
      push(block.id, block.name, {
        id: block.id,
        position: [block.x, height / 2 + 0.42, block.z],
        size: [CONFIG.fileWidth, height, CONFIG.fileDepth],
        aisleFace: 1,
      })
    }
    return items
  }, [
    ghosts,
    mapping,
    overlayBlocks,
    pointedFileColors,
    pointedFileIds,
    selectedId,
    viewGraph.files,
    viewLayout.files,
    explainActive,
    explainFocus,
  ])

  const dimmedFolderPaths = useMemo(() => {
    if (!explainActive || !explainHasFocus(explainFocus)) return []
    return Object.keys(viewLayout.folders).filter(
      (path) => !explainFolderFocused(explainFocus, path),
    )
  }, [explainActive, explainFocus, viewLayout.folders])

  return (
    <>
      <color attach="background" args={[WORLD_VOID]} />
      {!mapping && <fog attach="fog" args={[WORLD_VOID, 38, 160]} />}
      <hemisphereLight args={['#d7e2ee', '#2a3038', mapping ? 1.1 : 0.85]} />
      <directionalLight
        position={mapping ? [8, 60, 8] : [12, 22, 8]}
        intensity={mapping ? 1.35 : 0.55}
      />
      <ambientLight intensity={mapping ? 0.7 : 0.42} />
      <MapView
        layout={viewLayout}
        enabled={mapping}
        marker={explainActive ? null : mapMarker}
        highlightedFolders={highlightedFolders}
        selectedFolder={selectedFolder}
        namingFolderPath={namingIslandId}
        namingFileId={namingId}
        pointedFolderPaths={pointedFolderPaths}
        pointedFolderColors={pointedFolderColors}
        fileLabels={mapFileLabels}
        focusBounds={focusBounds}
        focusFlightKey={focusFlightKey}
        hudReserve={explainActive ? 24 : 88}
        topReserve={explainActive ? 24 : 28}
        landEnabled={landEnabled}
        dimmedFolderPaths={dimmedFolderPaths}
        onLand={onLand}
        onSelect={onSelect}
        onSelectFolder={onSelectFolder}
        pickingImport={pickingImport}
        onBlueprintMenu={
          mapping && !placing && !explainActive && onBlueprintMenu
            ? onBlueprintMenu
            : undefined
        }
      />

      {Object.values(viewLayout.folders).map((folder) => {
        if (lod && !lod.folders.has(folder.path)) return null
        return (
          <FolderArea
            key={folder.path}
            folder={folder}
            naming={folder.path === namingIslandId}
            selected={folder.path === selectedFolder}
            mapMode={mapping}
            highlightKind={
              mapping ? highlightedFolders[folder.path] ?? null : null
            }
            pointed={pointedFolders.has(folder.path)}
            pointedColors={pointedFolderColors[folder.path]}
            opacity={
              explainActive && !explainFolderFocused(explainFocus, folder.path)
                ? 0.5
                : 1
            }
            labelVisible={!lod || lod.folderLabels.has(folder.path)}
          />
        )
      })}
      {viewLayout.bridges.map((bridge) => {
        if (lod && !lod.bridges.has(bridge.id)) return null
        return (
          <Bridge key={bridge.id} bridge={bridge} folders={viewLayout.folders} />
        )
      })}
      {viewGraph.files.map((file) => {
        const placed = viewLayout.files[file.id]
        if (!placed) return null
        const selected = file.id === selectedId
        const isRelated = related.has(file.id)
        const isPlanned = planned.has(file.id) || deleted.has(file.id)
        const changeKind = fileChangeKind(file.id, planned, created, deleted)
        const naming = file.id === namingId
        const aimed = file.id === aimedRelation?.flyTo
        const pointed = pointedFiles.has(file.id)
        const focused = explainFileHighlighted(explainFocus, file.id, file.folder)
        const detailed =
          selected ||
          isRelated ||
          isPlanned ||
          naming ||
          aimed ||
          pointed ||
          focused ||
          Boolean(changeKind)
        if (lod && !lod.files.has(file.id)) return null
        const dimmed =
          explainActive
            ? !explainFileFocused(explainFocus, file.id, file.folder)
            : hasFocus &&
              !selected &&
              !isRelated &&
              !changeKind &&
              !pointed &&
              !patchLinked.has(file.id) &&
              !folderFileIds.has(file.id)
        const opacity = explainActive && dimmed ? 0.5 : 1
        if (lod && !detailed && !lod.labels.has(file.id)) {
          distantFiles.push({ file, placed, dimmed })
          return null
        }
        return (
          <FileBlock
            key={file.id}
            file={file}
            placed={placed}
            selected={selected}
            related={isRelated}
            planned={isPlanned}
            changeKind={changeKind}
            added={created.has(file.id) || file.userCreated}
            aimed={aimed}
            pointed={pointed}
            pointedColors={pointedFileColors[file.id]}
            dimmed={dimmed}
            focused={focused}
            opacity={opacity}
            naming={naming}
            mapMode={mapping}
            labelVisible={!lod || lod.labels.has(file.id) || naming}
          />
        )
      })}
      <DistantFileBlocks items={distantFiles} />
      {overlayBlocks.map((block) => {
        const file = toCreatedFile(block)
        const height = fileHeight(12)
        const placed: PlacedFile = {
          id: block.id,
          position: [block.x, height / 2 + 0.42, block.z],
          size: [CONFIG.fileWidth, height, CONFIG.fileDepth],
          aisleFace: 1,
        }
        return (
          <FileBlock
            key={`blueprint:${block.id}`}
            file={file}
            placed={placed}
            selected={file.id === selectedId}
            related={false}
            planned={false}
            changeKind="add"
            added
            pointed={pointedFiles.has(file.id)}
            pointedColors={pointedFileColors[file.id]}
            dimmed={
              explainActive &&
              !explainFileFocused(explainFocus, file.id, file.folder)
            }
            focused={explainFileHighlighted(explainFocus, file.id, file.folder)}
            opacity={
              explainActive &&
              !explainFileFocused(explainFocus, file.id, file.folder)
                ? 0.5
                : 1
            }
            mapMode={mapping}
            labelVisible
          />
        )
      })}
      {Object.values(ghosts).map((placed) => {
        const file: FileNode = {
          id: placed.id,
          name: placed.id.split('/').pop() ?? placed.id,
          path: placed.id,
          folder: folderOfFile(placed.id),
          lines: createLines[placed.id] ?? 12,
          language: placed.id.split('.').pop()?.toLowerCase() ?? 'txt',
          symbols: [],
          imports: plannedImports
            .filter((edge) => edge.from === placed.id)
            .map((edge) => edge.to),
        }
        return (
          <FileBlock
            key={`add:${file.id}`}
            file={file}
            placed={placed}
            selected={file.id === selectedId}
            related={false}
            planned
            changeKind="add"
            added
            dimmed={
              explainActive &&
              !explainFileFocused(explainFocus, file.id, file.folder)
            }
            focused={explainFileHighlighted(explainFocus, file.id, file.folder)}
            opacity={
              explainActive &&
              !explainFileFocused(explainFocus, file.id, file.folder)
                ? 0.5
                : 1
            }
            mapMode={mapping}
          />
        )
      })}
      <RelationLines
        selectedId={selectedId}
        aimedRelation={aimedRelation}
        files={viewGraph.files}
        layout={viewLayout}
        extras={ghosts}
        plannedIds={plannedIds}
        plannedEdges={plannedImports}
        extraEdges={explainFocus?.relations ?? []}
        fromAbove={mapping}
        importedBy={importedBy}
      />
      <Player
        layout={layout}
        mode={mode}
        landAt={landAt}
        locked={locked}
        lockEnabled={!placing}
        onLockedChange={onLockedChange}
        onWalkPosition={onWalkPosition}
        flyTo={flyTo}
      />
      {!mapping && (
        <WalkLodTracker
          files={layout.files}
          folders={layout.folders}
          bridges={layout.bridges}
          keepFileIds={keepFileIds}
          keepFolderPaths={keepFolderPaths}
          origin={landAt}
          onChange={setWalkLod}
        />
      )}
      <SelectionController
        locked={locked && !mapping}
        onSelect={onSelect}
        onInspect={onInspect}
        onAimFile={onAimFile}
        onAimRelation={onAimRelation}
        onTravelTo={onTravelTo}
        files={{ ...layout.files, ...ghosts }}
      />
      <UserContextTracker
        graph={graph}
        layout={layout}
        mode={mode}
        selectedId={selectedId}
        userCreatedBlocks={userCreatedBlocks}
        userCreatedIslands={userCreatedIslands}
        onContext={onContext}
      />
    </>
  )
}
