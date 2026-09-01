import { useMemo, useState } from 'react'
import { FolderArea } from './FolderArea'
import { FileBlock } from './FileBlock'
import { DistantFileBlocks } from './DistantFileBlocks'
import { Bridge } from './Bridge'
import { MapBatches } from './MapBatches'
import {
  collectMapBridgeItems,
  collectMapFileItems,
  collectMapFolderItems,
} from './collectMapBatches'
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
  isBlueprintFolder,
  mapPointOntoFolder,
} from '../layout'
import {
  explainBridgeFocused,
  explainFileFocused,
  explainFileHighlighted,
  explainFolderFocused,
  explainHasFocus,
  type ExplainFocus,
} from '../explain'
import { BLUEPRINT_OVERLAY, CONFIG, WORLD_VOID, blueprintPalette, explainItemOpacity, fileEmphasisScale } from '../theme'
import type {
  CodebaseGraph,
  FileNode,
  FlyTo,
  AimedRelation,
  PatchImport,
  PlacedBridge,
  PlacedFile,
  PlacedFolder,
  RelationMode,
  UserContext,
  UserCreatedBlock,
  UserCreatedIsland,
  ViewMode,
  WorldLayout,
} from '../types'
import { mergeOverlayOnlyFolders, toCreatedFile, type BlueprintOverlayLayer } from '../userCreated'

type WorldProps = {
  graph: CodebaseGraph
  layout: WorldLayout
  mode: ViewMode
  landAt: [number, number]
  selectedId: string | null
  selectedFolder?: string | null
  selectedFolderLayer?: string | null
  locked: boolean
  onSelect: (fileId: string | null) => void
  onSelectFolder: (folderPath: string | null, layer?: string | null) => void
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
  relationMode?: RelationMode
  namingId?: string | null
  onBlueprintMenu?: (menu: MapBlueprintMenu) => void
  userCreatedBlocks?: UserCreatedBlock[]
  userCreatedIslands?: UserCreatedIsland[]
  overlayLayers?: BlueprintOverlayLayer[]
  overlayOpacity?: number
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
  selectedFolderLayer = null,
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
  relationMode = 'changed',
  namingId = null,
  namingIslandId = null,
  onBlueprintMenu,
  userCreatedBlocks = [],
  userCreatedIslands = [],
  overlayLayers = [],
  overlayOpacity = BLUEPRINT_OVERLAY.strength,
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
  const extraKey = Object.keys(ghosts).join('|')
  const folderFocusIds = useMemo(() => {
    if (!selectedFolder || selectedId) return [] as string[]
    const ids = new Set<string>()
    const overlay = selectedFolderLayer
      ? overlayLayers.find((layer) => layer.id === selectedFolderLayer)
      : undefined
    if (overlay) {
      for (const id of Object.keys(overlay.files)) {
        if (folderOfFile(id) === selectedFolder) ids.add(id)
      }
      return [...ids]
    }
    const folderNode = viewGraph.folders.find(
      (folder) => folder.path === selectedFolder,
    )
    if (folderNode) {
      for (const id of folderNode.files) ids.add(id)
    }
    for (const file of viewGraph.files) {
      if (file.folder === selectedFolder) ids.add(file.id)
    }
    if (extraKey) {
      for (const id of extraKey.split('|')) {
        if (folderOfFile(id) === selectedFolder) ids.add(id)
      }
    }
    return [...ids]
  }, [
    extraKey,
    overlayLayers,
    selectedFolder,
    selectedFolderLayer,
    selectedId,
    viewGraph.files,
    viewGraph.folders,
  ])
  const selectionFocus = Boolean(selectedId || folderFocusIds.length > 0)
  const hideMapRelations = mapping && relationMode === 'off'
  const showExistingRelations =
    !mapping || explainActive || relationMode === 'all'
  const fileImportedBy = Boolean(importedBy && selectedId)
  const related = new Set(
    hideMapRelations || (!showExistingRelations && !selectionFocus && relationMode !== 'changed')
      ? []
      : selectedId && showExistingRelations
      ? fileImportedBy
        ? filesImporting(viewGraph.files, selectedId).map((file) => file.id)
        : (viewGraph.files.find((file) => file.id === selectedId)?.imports ?? [])
      : folderFocusIds.length > 0 && showExistingRelations
        ? viewGraph.files
            .filter((file) => folderFocusIds.includes(file.id))
            .flatMap((file) => file.imports)
        : [],
  )
  const patchLinked = new Set<string>()
  for (const edge of plannedImports) {
    patchLinked.add(edge.from)
    patchLinked.add(edge.to)
    if (mapping && relationMode === 'off') continue
    if (mapping && relationMode === 'targeted') {
      const focus = selectedId ? [selectedId] : folderFocusIds
      if (!focus.includes(edge.from) && !focus.includes(edge.to)) continue
    }
    if (!planned.has(edge.to) && !deleted.has(edge.to)) related.add(edge.to)
    if (!planned.has(edge.from) && !deleted.has(edge.from)) related.add(edge.from)
  }
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
    const overlayFileHex = new Map<string, string>()
    const overlayFolderHex = new Map<string, string>()
    for (const layer of overlayLayers) {
      for (const path of Object.keys(layer.folders)) {
        overlayFolderHex.set(path, layer.colorHex)
      }
      for (const id of Object.keys(layer.files)) {
        overlayFileHex.set(id, layer.colorHex)
      }
    }
    const labelHex = (id: string, folder: string) =>
      overlayFileHex.get(id) ?? overlayFolderHex.get(folder)
    const push = (
      id: string,
      name: string,
      placed: PlacedFile,
      extra?: { blueprintHex?: string; overlay?: boolean },
    ) => {
      if (!placed || seen.has(id)) return
      seen.add(id)
      const colors = pointedFileColors[id]
      const kind = fileChangeKind(id, planned, created, deleted)
      const scale = fileEmphasisScale(Boolean(extra?.overlay), kind)
      items.push({
        id,
        name,
        x: placed.position[0],
        z: placed.position[2],
        width: placed.size[0] * scale,
        depth: placed.size[2] * scale,
        outer: -placed.aisleFace as 1 | -1,
        selected: id === selectedId,
        pointed: pointed.has(id),
        pointedColor: colors?.[colors.length - 1],
        dimmed:
          explainActive &&
          !explainFileFocused(explainFocus, id, folderOfFile(id)),
        focused: explainFileHighlighted(explainFocus, id, folderOfFile(id)),
        blueprintHex: extra?.blueprintHex,
        overlay: extra?.overlay,
      })
    }
    for (const file of viewGraph.files) {
      const placed = viewLayout.files[file.id]
      const hex = labelHex(file.id, file.folder)
      if (placed) push(file.id, file.name, placed, hex ? { blueprintHex: hex } : undefined)
    }
    for (const placed of Object.values(ghosts)) {
      const hex = labelHex(placed.id, folderOfFile(placed.id))
      push(
        placed.id,
        placed.id.split('/').pop() ?? placed.id,
        placed,
        hex ? { blueprintHex: hex } : undefined,
      )
    }
    if (mapping) {
      const filled = new Set(overlayLayers.flatMap((layer) => layer.filledIds))
      for (const layer of overlayLayers) {
        for (const [id, placed] of Object.entries(layer.files)) {
          if (filled.has(id) || seen.has(id)) continue
          const name = id.split('/').pop() ?? id
          push(id, `+ ${name}`, placed, {
            blueprintHex: layer.colorHex,
            overlay: true,
          })
        }
      }
    }
    return items
  }, [
    createdIds,
    deletedIds,
    explainActive,
    explainFocus,
    ghosts,
    mapping,
    overlayLayers,
    plannedIds,
    pointedFileColors,
    pointedFileIds,
    selectedId,
    viewGraph.files,
    viewLayout.files,
  ])

  const dimmedFolderPaths = useMemo(() => {
    if (!explainActive || !explainHasFocus(explainFocus)) return []
    return Object.keys(viewLayout.folders).filter(
      (path) => !explainFolderFocused(explainFocus, path),
    )
  }, [explainActive, explainFocus, viewLayout.folders])

  const mapViewLayout = useMemo(
    () =>
      mapping ? mergeOverlayOnlyFolders(viewLayout, overlayLayers) : viewLayout,
    [mapping, overlayLayers, viewLayout],
  )
  const overlayFileIds = useMemo(() => {
    if (!mapping) return new Set<string>()
    const ids = new Set<string>()
    for (const layer of overlayLayers) {
      for (const id of Object.keys(layer.files)) ids.add(id)
    }
    return ids
  }, [mapping, overlayLayers])
  const overlayFolderPaths = useMemo(() => {
    if (!mapping) return new Set<string>()
    const paths = new Set<string>()
    for (const layer of overlayLayers) {
      for (const path of Object.keys(layer.folders)) paths.add(path)
    }
    return paths
  }, [mapping, overlayLayers])
  const mapSkipFileIds = useMemo(() => {
    if (!mapping) return new Set<string>()
    const ids = new Set<string>()
    if (selectedId) ids.add(selectedId)
    if (namingId) ids.add(namingId)
    if (aimedRelation?.flyTo) ids.add(aimedRelation.flyTo)
    for (const id of pointedFileIds) ids.add(id)
    for (const id of related) ids.add(id)
    for (const id of plannedIds) ids.add(id)
    for (const id of createdIds) ids.add(id)
    for (const id of deletedIds) ids.add(id)
    for (const file of viewGraph.files) {
      if (file.userCreated && overlayFileIds.has(file.id)) ids.add(file.id)
      if (
        explainActive &&
        explainFileHighlighted(explainFocus, file.id, file.folder)
      ) {
        ids.add(file.id)
      }
    }
    return ids
  }, [
    aimedRelation?.flyTo,
    createdIds,
    deletedIds,
    explainActive,
    explainFocus,
    mapping,
    namingId,
    overlayFileIds,
    plannedIds,
    pointedFileIds,
    related,
    selectedId,
    viewGraph.files,
  ])
  const mapSkipFolderPaths = useMemo(() => {
    if (!mapping) return new Set<string>()
    const paths = new Set<string>()
    if (selectedFolder && !selectedFolderLayer) paths.add(selectedFolder)
    if (namingIslandId) paths.add(namingIslandId)
    for (const path of pointedFolderPaths) paths.add(path)
    for (const path of Object.keys(highlightedFolders)) paths.add(path)
    for (const folder of Object.values(viewLayout.folders)) {
      if (folder.added) paths.add(folder.path)
    }
    return paths
  }, [
    highlightedFolders,
    mapping,
    namingIslandId,
    pointedFolderPaths,
    selectedFolder,
    selectedFolderLayer,
    viewLayout.folders,
  ])
  const mapBatches = useMemo(() => {
    if (!mapping) {
      return { files: [], floors: [], aisles: [], bridges: [] }
    }
    const files = collectMapFileItems(
      viewGraph.files,
      viewLayout.files,
      mapSkipFileIds,
      (id, folder) =>
        explainActive && !explainFileFocused(explainFocus, id, folder),
    )
    const { floors, aisles } = collectMapFolderItems(
      viewLayout.folders,
      mapSkipFolderPaths,
      (path) => explainActive && !explainFolderFocused(explainFocus, path),
    )
    return {
      files,
      floors,
      aisles,
      bridges: collectMapBridgeItems(
        viewLayout.bridges,
        viewLayout.folders,
        (id) => explainActive && !explainBridgeFocused(explainFocus, id),
      ),
    }
  }, [
    explainActive,
    explainFocus,
    mapSkipFileIds,
    mapSkipFolderPaths,
    mapping,
    viewGraph.files,
    viewLayout.bridges,
    viewLayout.files,
    viewLayout.folders,
  ])

  const mapDetailFolders = useMemo(() => {
    if (!mapping) return null
    return Object.values(viewLayout.folders).filter(
      (folder) =>
        mapSkipFolderPaths.has(folder.path) &&
        !(folder.added && overlayFolderPaths.has(folder.path)),
    )
  }, [mapping, mapSkipFolderPaths, overlayFolderPaths, viewLayout.folders])
  const mapDetailFiles = useMemo(() => {
    if (!mapping) return null
    return viewGraph.files.filter((file) => {
      if (!mapSkipFileIds.has(file.id) || !viewLayout.files[file.id]) return false
      return !(file.userCreated && overlayFileIds.has(file.id))
    })
  }, [
    mapping,
    mapSkipFileIds,
    overlayFileIds,
    viewGraph.files,
    viewLayout.files,
  ])

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
        layout={mapViewLayout}
        fitLayout={viewLayout}
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

      {mapping && (
        <MapBatches
          files={mapBatches.files}
          floors={mapBatches.floors}
          aisles={mapBatches.aisles}
          bridges={mapBatches.bridges}
        />
      )}

      {(mapDetailFolders ?? Object.values(viewLayout.folders)).map((folder) => {
        if (lod && !lod.folders.has(folder.path)) return null
        return (
          <FolderArea
            key={folder.path}
            folder={folder}
            naming={folder.path === namingIslandId}
            selected={
              folder.path === selectedFolder && !selectedFolderLayer
            }
            mapMode={mapping}
            highlightKind={
              mapping
                ? isBlueprintFolder(folder) &&
                  highlightedFolders[folder.path] === 'add'
                  ? null
                  : highlightedFolders[folder.path] ?? null
                : null
            }
            pointed={pointedFolders.has(folder.path)}
            pointedColors={pointedFolderColors[folder.path]}
            opacity={explainItemOpacity(
              explainActive && !explainFolderFocused(explainFocus, folder.path),
            )}
            labelVisible={!lod || lod.folderLabels.has(folder.path)}
            pickPath={folder.path}
          />
        )
      })}
      {!mapping &&
        viewLayout.bridges.map((bridge) => {
          if (lod && !lod.bridges.has(bridge.id)) return null
          return (
            <Bridge key={bridge.id} bridge={bridge} folders={viewLayout.folders} />
          )
        })}
      {(mapDetailFiles ?? viewGraph.files).map((file) => {
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
          explainActive &&
          !explainFileFocused(explainFocus, file.id, file.folder)
        const opacity = explainItemOpacity(dimmed)
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
      {mapping &&
        overlayLayers.map((layer) => (
          <BlueprintOverlay
            key={`layer:${layer.id}`}
            layer={layer}
            graph={viewGraph}
            layout={viewLayout}
            selectedId={selectedId}
            selectedFolder={selectedFolder}
            selectedFolderLayer={selectedFolderLayer}
            namingId={namingId}
            namingIslandId={namingIslandId}
            pointedFiles={pointedFiles}
            pointedFileColors={pointedFileColors}
            explainActive={explainActive}
            explainFocus={explainFocus}
            overlayOpacity={overlayOpacity}
          />
        ))}
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
            opacity={explainItemOpacity(
              explainActive &&
                !explainFileFocused(explainFocus, file.id, file.folder),
            )}
            mapMode={mapping}
          />
        )
      })}
      {(!mapping ||
        explainActive ||
        relationMode === 'all' ||
        relationMode === 'changed' ||
        (relationMode === 'targeted' && selectionFocus)) && (
        <RelationLines
          selectedId={
            mapping && (relationMode === 'all' || relationMode === 'changed')
              ? null
              : selectedId
          }
          aimedRelation={aimedRelation}
          onAimRelation={mapping ? onAimRelation : undefined}
          files={viewGraph.files}
          layout={viewLayout}
          extras={ghosts}
          plannedIds={plannedIds}
          plannedEdges={plannedImports}
          extraEdges={explainFocus?.relations ?? []}
          fromAbove={mapping}
          importedBy={fileImportedBy}
          focusIds={relationMode === 'targeted' ? folderFocusIds : []}
          drawPlanned={
            !mapping ||
            explainActive ||
            relationMode === 'all' ||
            relationMode === 'changed'
          }
          drawExisting={
            !mapping || explainActive || relationMode === 'all'
          }
        />
      )}
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

function OverlayBridgeStrip({
  bridge,
  color,
  y,
  opacity,
}: {
  bridge: PlacedBridge
  color: string
  y: number
  opacity: number
}) {
  const from = bridge.points[0]
  const to = bridge.points[bridge.points.length - 1]
  if (!from || !to) return null
  const x = (from[0] + to[0]) / 2
  const z = (from[1] + to[1]) / 2
  const alongX = Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1])
  const length = Math.hypot(to[0] - from[0], to[1] - from[1])
  return (
    <mesh position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry
        args={
          alongX
            ? [length, CONFIG.bridgeWidth]
            : [CONFIG.bridgeWidth, length]
        }
      />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={BLUEPRINT_OVERLAY.folderOpacity * opacity}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}

function clipFolderAwayFromUnrelated(
  folder: PlacedFolder,
  others: PlacedFolder[],
): PlacedFolder {
  let left = folder.x - folder.width / 2
  let right = folder.x + folder.width / 2
  for (const other of others) {
    if (other.path === folder.path) continue
    if (other.name === folder.name) continue
    if (
      folder.z >= other.z + other.depth ||
      folder.z + folder.depth <= other.z
    ) {
      continue
    }
    const otherLeft = other.x - other.width / 2
    const otherRight = other.x + other.width / 2
    if (left >= otherRight || right <= otherLeft) continue
    const keepLeft = otherLeft - left
    const keepRight = right - otherRight
    if (keepLeft >= keepRight) right = Math.min(right, otherLeft)
    else left = Math.max(left, otherRight)
  }
  const width = right - left
  if (width < 0.5) return folder
  return {
    ...folder,
    x: (left + right) / 2,
    width,
  }
}

function overlayFolderBounds(
  folder: PlacedFolder,
  layoutFolders: Record<string, PlacedFolder>,
  naming: boolean,
): PlacedFolder | null {
  const existing = layoutFolders[folder.path]
  if (existing && !naming && folder.name && folder.name !== existing.name) {
    return null
  }
  return clipFolderAwayFromUnrelated(folder, Object.values(layoutFolders))
}

function BlueprintOverlay({
  layer,
  graph,
  layout,
  selectedId,
  selectedFolder,
  selectedFolderLayer,
  namingId,
  namingIslandId,
  pointedFiles,
  pointedFileColors,
  explainActive,
  explainFocus,
  overlayOpacity,
}: {
  layer: BlueprintOverlayLayer
  graph: CodebaseGraph
  layout: WorldLayout
  selectedId: string | null
  selectedFolder: string | null
  selectedFolderLayer: string | null
  namingId: string | null
  namingIslandId: string | null
  pointedFiles: Set<string>
  pointedFileColors: Record<string, string[]>
  explainActive: boolean
  explainFocus: ExplainFocus | null
  overlayOpacity: number
}) {
  const filled = new Set(layer.filledIds)
  const filesById = new Map(graph.files.map((file) => [file.id, file]))
  const tint = blueprintPalette(layer.colorHex)

  return (
    <group>
      {Object.values(layer.folders).map((folder) => {
        const overlayFolder = overlayFolderBounds(
          folder,
          layout.folders,
          folder.path === namingIslandId,
        )
        if (!overlayFolder) return null
        return (
          <FolderArea
            key={`overlay-folder:${layer.id}:${folder.path}`}
            folder={overlayFolder}
            naming={folder.path === namingIslandId}
            selected={
              folder.path === selectedFolder && selectedFolderLayer === layer.id
            }
            mapMode
            overlay
            overlayY={layer.folderY}
            opacity={explainItemOpacity(
              explainActive && !explainFolderFocused(explainFocus, folder.path),
              overlayOpacity,
            )}
            labelVisible={false}
            pickPath={folder.path}
            pickLayer={layer.id}
          />
        )
      })}
      {layer.bridges.map((bridge) => (
        <OverlayBridgeStrip
          key={`overlay-bridge:${layer.id}:${bridge.id}`}
          bridge={bridge}
          color={tint.color}
          y={layer.folderY}
          opacity={explainItemOpacity(
            explainActive && !explainBridgeFocused(explainFocus, bridge.id),
            overlayOpacity,
          )}
        />
      ))}
      {Object.entries(layer.files).map(([id, placed]) => {
        const existing = filesById.get(id)
        const layoutFile = layout.files[id]
        const overlayPlaced: PlacedFile = layoutFile
          ? {
              ...placed,
              position: [
                layoutFile.position[0],
                placed.position[1],
                layoutFile.position[2],
              ],
              size: layoutFile.size,
              aisleFace: layoutFile.aisleFace,
            }
          : placed
        const file = existing
          ? { ...existing, userCreated: true, colorHex: layer.colorHex }
          : toCreatedFile({
              id,
              name: id.split('/').pop() ?? id,
              path: id,
              folder: folderOfFile(id),
              x: overlayPlaced.position[0],
              z: overlayPlaced.position[2],
              colorHex: layer.colorHex,
            })
        const isFilled = filled.has(id)
        const dimmed =
          explainActive &&
          !explainFileFocused(explainFocus, id, file.folder)
        return (
          <FileBlock
            key={`overlay-file:${layer.id}:${id}`}
            file={{ ...file, colorHex: layer.colorHex, userCreated: true }}
            placed={overlayPlaced}
            selected={id === selectedId}
            related={false}
            planned={false}
            changeKind={isFilled ? null : 'add'}
            added={!isFilled}
            overlay
            overlayFilled={isFilled}
            pointed={pointedFiles.has(id)}
            pointedColors={pointedFileColors[id]}
            dimmed={dimmed}
            focused={explainFileHighlighted(explainFocus, id, file.folder)}
            opacity={explainItemOpacity(
              dimmed,
              overlayOpacity * BLUEPRINT_OVERLAY.fileOpacity,
            )}
            naming={id === namingId}
            mapMode
            labelVisible={false}
          />
        )
      })}
    </group>
  )
}
