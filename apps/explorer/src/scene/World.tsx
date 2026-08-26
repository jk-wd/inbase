import { useMemo, useState } from 'react'
import { FolderArea } from './FolderArea'
import { FileBlock } from './FileBlock'
import { DistantFileBlocks } from './DistantFileBlocks'
import { Bridge } from './Bridge'
import { RelationLines } from './RelationLines'
import { Player } from './Player'
import { MapView, type MapBlueprintMenu } from './MapView'
import { SelectionController } from './SelectionController'
import { UserContextTracker } from './UserContextTracker'
import { BlockPlacer } from './BlockPlacer'
import { IslandPlacer } from './IslandPlacer'
import { WalkLodTracker } from './WalkLodTracker'
import { computeWalkLod, type WalkLod } from './walkLod'
import {
  fileChangeKind,
  filesImporting,
  folderChangeHighlights,
  folderOfFile,
  mapPointOntoFolder,
} from '../layout'
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
  onPlaceBlock?: (spot: { x: number; z: number; folder: string }) => void
  onPlaceIsland?: (parent: string) => void
  onBlueprintMenu?: (menu: MapBlueprintMenu) => void
  onCommitName?: (id: string, name: string) => boolean
  onCancelName?: (id: string) => void
  onCommitIslandName?: (id: string, name: string) => boolean
  onCancelIslandName?: (id: string) => void
  userCreatedBlocks?: UserCreatedBlock[]
  userCreatedIslands?: UserCreatedIsland[]
  overlayBlocks?: UserCreatedBlock[]
  namingIslandId?: string | null
  mapGraph?: CodebaseGraph | null
  mapLayout?: WorldLayout | null
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
  onPlaceBlock,
  onPlaceIsland,
  onBlueprintMenu,
  onCommitName,
  onCancelName,
  onCommitIslandName,
  onCancelIslandName,
  userCreatedBlocks = [],
  userCreatedIslands = [],
  overlayBlocks = [],
  mapGraph = null,
  mapLayout = null,
}: WorldProps) {
  const created = new Set(createdIds)
  const deleted = new Set(deletedIds)
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
        ? filesImporting(graph.files, selectedId).map((file) => file.id)
        : (graph.files.find((file) => file.id === selectedId)?.imports ?? [])
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
    if (ghostKey) {
      for (const id of ghostKey.split('|')) ids.add(id)
    }
    return ids
  }, [aimedRelation?.flyTo, ghostKey, namingId, selectedId])
  const keepFolderPaths = useMemo(() => {
    const paths = new Set<string>()
    if (selectedFolder) paths.add(selectedFolder)
    if (namingIslandId) paths.add(namingIslandId)
    return paths
  }, [namingIslandId, selectedFolder])
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
        marker={mapMarker}
        highlightedFolders={highlightedFolders}
        selectedFolder={selectedFolder}
        namingFolderPath={namingIslandId}
        onLand={onLand}
        onSelect={onSelect}
        onSelectFolder={onSelectFolder}
        onTravelTo={onTravelTo}
        onBlueprintMenu={
          mapping && !placing && onBlueprintMenu ? onBlueprintMenu : undefined
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
            labelVisible={!lod || lod.folderLabels.has(folder.path)}
            onCommitName={
              folder.path === namingIslandId && onCommitIslandName
                ? (name) => {
                    onCommitIslandName(folder.path, name)
                  }
                : undefined
            }
            onCancelName={
              folder.path === namingIslandId && onCancelIslandName
                ? () => onCancelIslandName(folder.path)
                : undefined
            }
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
        const detailed =
          selected || isRelated || isPlanned || naming || aimed || Boolean(changeKind)
        if (lod && !lod.files.has(file.id)) return null
        const dimmed =
          hasFocus &&
          !selected &&
          !isRelated &&
          !changeKind &&
          !patchLinked.has(file.id) &&
          !folderFileIds.has(file.id)
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
            dimmed={dimmed}
            naming={naming}
            mapMode={mapping}
            labelVisible={!lod || lod.labels.has(file.id) || naming}
            onCommitName={
              naming && onCommitName
                ? (name) => {
                    onCommitName(file.id, name)
                  }
                : undefined
            }
            onCancelName={
              naming && onCancelName ? () => onCancelName(file.id) : undefined
            }
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
            dimmed={false}
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
            dimmed={false}
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
        plannedEdges={plannedImports}
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
      {onPlaceBlock && (
        <BlockPlacer
          enabled={!mapping && !placing}
          layout={layout}
          onPlace={onPlaceBlock}
        />
      )}
      {onPlaceIsland && (
        <IslandPlacer
          enabled={!mapping && !placing}
          layout={layout}
          onPlace={onPlaceIsland}
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
