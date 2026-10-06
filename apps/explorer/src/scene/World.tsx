import { useMemo, useState } from 'react'
import { FolderArea } from './FolderArea'
import { FileBlock, FileMarks } from './FileBlock'
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
import { MapView, type MapBlueprintMenu, type MapFocusBounds } from './MapView'
import type { MapFileLabel } from './MapFileLabels'
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
import { BLUEPRINT_OVERLAY, EXPLAIN_FOCUS, WORLD_VOID, blueprintPalette, capMapPieceOpacity, explainItemOpacity, fileEmphasisScale } from '../theme'
import type {
  CodebaseGraph,
  FileNode,
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
import { mapBridgeLine } from './mapBridgeLine'
import type { MapSheet } from './mapLabelOcclusion'
import {
  mergeOverlayOnlyFolders,
  overlayFolderY,
  toCreatedFile,
  type BlueprintOverlayLayer,
} from '../userCreated'

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
  onExitWalk?: () => void
  onContext: (context: UserContext) => void
  plannedIds: string[]
  previewFiles: Record<string, PlacedFile>
  plannedImports: PatchImport[]
  createdIds: string[]
  deletedIds?: string[]
  createLines: Record<string, number>
  aimedRelation: AimedRelation | null
  onAimRelation: (aim: AimedRelation | null) => void
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
  notedFileIds?: string[]
  notedFileColors?: Record<string, string[]>
  notedFolderPaths?: string[]
  notedFolderColors?: Record<string, string[]>
  namingIslandId?: string | null
  mapGraph?: CodebaseGraph | null
  mapLayout?: WorldLayout | null
  explainActive?: boolean
  explainFocus?: ExplainFocus | null
  focusBounds?: MapFocusBounds | null
  focusFlightKey?: string | number
  revealBounds?: MapFocusBounds | null
  revealFlightKey?: string | number
  landEnabled?: boolean
  droppingWalk?: boolean
  onOpenFileNote?: (fileId: string, color?: string) => void
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
  onExitWalk,
  onContext,
  plannedIds,
  previewFiles,
  plannedImports,
  createdIds,
  deletedIds = [],
  createLines,
  aimedRelation,
  onAimRelation,
  importedBy = false,
  relationMode = 'targeted',
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
  notedFileIds = [],
  notedFileColors = {},
  notedFolderPaths = [],
  notedFolderColors = {},
  mapGraph = null,
  mapLayout = null,
  explainActive = false,
  explainFocus = null,
  focusBounds = null,
  focusFlightKey = 0,
  revealBounds = null,
  revealFlightKey = 0,
  landEnabled = true,
  droppingWalk = false,
  onOpenFileNote,
}: WorldProps) {
  const created = new Set(createdIds)
  const deleted = new Set(deletedIds)
  const pointedFiles = new Set(pointedFileIds)
  const pointedFolders = new Set(pointedFolderPaths)
  const notedFiles = new Set(notedFileIds)
  const notedFolders = new Set(notedFolderPaths)
  const mapping = mode === 'map'
  const viewGraph = mapping && mapGraph ? mapGraph : graph
  const groundLayout = mapping && mapLayout ? mapLayout : layout
  const sheetUnderFile = useMemo(
    () =>
      mapping
        ? filesUnderBlueprints(groundLayout, overlayLayers, namingIslandId)
        : new Map<string, number>(),
    [groundLayout, mapping, namingIslandId, overlayLayers],
  )
  const viewLayout = useMemo(
    () => flattenFilesUnderBlueprints(groundLayout, sheetUnderFile),
    [groundLayout, sheetUnderFile],
  )
  /** Relation ends follow what is drawn: blueprint blocks, or the sheet over covered map files. */
  const relationAnchors = useMemo(() => {
    if (!mapping || overlayLayers.length === 0) return previewFiles
    const anchors: Record<string, PlacedFile> = {}
    const blueprintIds = new Set(
      viewGraph.files.filter((file) => file.userCreated).map((file) => file.id),
    )
    for (const layer of overlayLayers) {
      for (const [id, placed] of Object.entries(layer.files)) {
        if (anchors[id] || !blueprintIds.has(id)) continue
        anchors[id] = overlayFilePlacement(placed, groundLayout.files[id])
      }
    }
    for (const [id, sheetY] of sheetUnderFile) {
      const file = viewLayout.files[id]
      if (!file || anchors[id]) continue
      anchors[id] = { ...file, position: [file.position[0], sheetY - file.size[1] / 2, file.position[2]] }
    }
    for (const layer of overlayLayers) {
      for (const [id, placed] of Object.entries(layer.files)) {
        if (!anchors[id]) anchors[id] = placed
      }
    }
    return { ...anchors, ...previewFiles }
  }, [
    groundLayout.files,
    mapping,
    overlayLayers,
    previewFiles,
    sheetUnderFile,
    viewGraph.files,
    viewLayout.files,
  ])
  const overlaySheets = useMemo(() => {
    const sheets: MapSheet[] = []
    if (!mapping) return sheets
    for (const layer of overlayLayers) {
      for (const folder of Object.values(layer.folders)) {
        const y = overlayFolderY(layer, folder.path)
        const bounds = overlayFolderBounds(
          folder,
          groundLayout.folders,
          folder.path === namingIslandId,
        )
        if (!bounds) continue
        sheets.push({
          path: folder.path,
          x: bounds.x,
          z: bounds.z,
          width: bounds.width,
          depth: bounds.depth,
          y,
        })
      }
    }
    return sheets
  }, [groundLayout.folders, mapping, namingIslandId, overlayLayers])
  const blueprintSheets = useMemo(
    () => overlaySheets.filter((sheet) => sheet.y > BLUEPRINT_OVERLAY.groundY),
    [overlaySheets],
  )
  /** Blueprint-only folders are titled by their highest sheet; real map folders keep their ground label. */
  const folderLabelAnchors = useMemo(() => {
    const anchors: Record<string, MapSheet> = {}
    for (const sheet of overlaySheets) {
      const onMap = groundLayout.folders[sheet.path]
      if (onMap && !onMap.added) continue
      const current = anchors[sheet.path]
      if (!current || sheet.y >= current.y) anchors[sheet.path] = sheet
    }
    return anchors
  }, [groundLayout.folders, overlaySheets])
  const mapMarker =
    groundLayout === layout
      ? landAt
      : mapPointOntoFolder(landAt[0], landAt[1], layout, groundLayout)
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
  const hideRelations = relationMode === 'off'
  const showExistingRelations =
    relationMode === 'all' || (relationMode === 'targeted' && selectionFocus)
  const showAllPlanned =
    relationMode === 'all' || relationMode === 'changed'
  const explainEdges = hideRelations ? [] : (explainFocus?.relations ?? [])
  const fileImportedBy = Boolean(importedBy && selectedId)
  const related = new Set(
    hideRelations ||
      (!showExistingRelations && !selectionFocus && relationMode !== 'changed')
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
    if (hideRelations) continue
    if (relationMode === 'targeted') {
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
    for (const id of notedFileIds) ids.add(id)
    if (ghostKey) {
      for (const id of ghostKey.split('|')) ids.add(id)
    }
    return ids
  }, [aimedRelation?.flyTo, ghostKey, namingId, notedFileIds, pointedFileIds, selectedId])
  const keepFolderPaths = useMemo(() => {
    const paths = new Set<string>()
    if (selectedFolder) paths.add(selectedFolder)
    if (namingIslandId) paths.add(namingIslandId)
    for (const path of pointedFolderPaths) paths.add(path)
    for (const path of notedFolderPaths) paths.add(path)
    return paths
  }, [namingIslandId, notedFolderPaths, pointedFolderPaths, selectedFolder])
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
    const noted = new Set(notedFileIds)
    const seen = new Set<string>()
    const items: MapFileLabel[] = []
    const overlayFileHex = new Map<string, string>()
    const overlayFileTop = new Map<string, number>()
    for (const layer of overlayLayers) {
      for (const [id, placed] of Object.entries(layer.files)) {
        overlayFileHex.set(id, layer.colorHex)
        if (!overlayFileTop.has(id)) {
          const drawn = overlayFilePlacement(placed, groundLayout.files[id])
          overlayFileTop.set(id, drawn.position[1] + drawn.size[1] / 2)
        }
      }
      for (const id of layer.filledIds) {
        overlayFileHex.set(id, layer.colorHex)
      }
    }
    const labelHex = (id: string, fileHex?: string) =>
      overlayFileHex.get(id) ?? fileHex
    const push = (
      id: string,
      name: string,
      placed: PlacedFile,
      extra?: { blueprintHex?: string; overlay?: boolean },
    ) => {
      if (!placed || seen.has(id)) return
      seen.add(id)
      const colors = pointedFileColors[id]
      const noteColors = notedFileColors[id]
      const kind = fileChangeKind(id, planned, created, deleted)
      const scale = fileEmphasisScale(Boolean(extra?.overlay), kind)
      const groundTop = placed.position[1] + placed.size[1] / 2
      items.push({
        id,
        name,
        x: placed.position[0],
        y: extra?.overlay ? (overlayFileTop.get(id) ?? groundTop) : groundTop,
        z: placed.position[2],
        width: placed.size[0] * scale,
        depth: placed.size[2] * scale,
        outer: -placed.aisleFace as 1 | -1,
        selected: id === selectedId,
        pointed: pointed.has(id),
        pointedColor: colors?.[colors.length - 1],
        pointedColors: colors,
        noted: noted.has(id),
        notedColor: noteColors?.[noteColors.length - 1],
        notedColors: noteColors,
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
      const hex = labelHex(file.id, file.colorHex)
      if (!placed) continue
      const blueprintOnly = Boolean(file.userCreated && overlayFileHex.has(file.id))
      push(
        file.id,
        file.name,
        placed,
        hex ? { blueprintHex: hex, overlay: blueprintOnly } : undefined,
      )
    }
    for (const placed of Object.values(ghosts)) {
      const hex = labelHex(placed.id)
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
    groundLayout.files,
    mapping,
    overlayLayers,
    plannedIds,
    pointedFileColors,
    pointedFileIds,
    notedFileColors,
    notedFileIds,
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
  const blueprintUnderlayIds = useMemo(() => {
    if (!mapping) return new Set<string>()
    const ids = new Set<string>()
    for (const layer of overlayLayers) {
      for (const id of layer.filledIds) ids.add(id)
    }
    return ids
  }, [mapping, overlayLayers])
  const createdFolderPaths = useMemo(() => {
    const paths = new Set<string>()
    for (const folder of viewGraph.folders) {
      if (folder.userCreated) paths.add(folder.path)
    }
    return paths
  }, [viewGraph.folders])
  const overlayBridgeIds = useMemo(() => {
    if (!mapping) return new Set<string>()
    const ids = new Set<string>()
    for (const layer of overlayLayers) {
      for (const bridge of layer.bridges) ids.add(bridge.id)
    }
    for (const bridge of viewLayout.bridges) {
      const child = bridge.id.split('→').pop()
      if (child && createdFolderPaths.has(child)) ids.add(bridge.id)
    }
    return ids
  }, [createdFolderPaths, mapping, overlayLayers, viewLayout.bridges])
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
    for (const id of related) ids.add(id)
    for (const id of plannedIds) ids.add(id)
    for (const id of createdIds) ids.add(id)
    for (const id of deletedIds) ids.add(id)
    for (const file of viewGraph.files) {
      if (
        overlayFileIds.has(file.id) &&
        (file.userCreated || createdFolderPaths.has(file.folder))
      ) {
        ids.add(file.id)
      }
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
    createdFolderPaths,
    overlayFileIds,
    plannedIds,
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
    for (const path of notedFolderPaths) paths.add(path)
    for (const path of Object.keys(highlightedFolders)) paths.add(path)
    for (const folder of Object.values(viewLayout.folders)) {
      if (folder.added) paths.add(folder.path)
    }
    return paths
  }, [
    highlightedFolders,
    mapping,
    namingIslandId,
    notedFolderPaths,
    pointedFolderPaths,
    selectedFolder,
    selectedFolderLayer,
    viewLayout.folders,
  ])
  const mapBatches = useMemo(() => {
    if (!mapping) {
      return { files: [], floors: [], bridges: [] }
    }
    const files = collectMapFileItems(
      viewGraph.files,
      viewLayout.files,
      mapSkipFileIds,
      (id, folder) =>
        explainActive && !explainFileFocused(explainFocus, id, folder),
    )
    const floors = collectMapFolderItems(
      viewLayout.folders,
      mapSkipFolderPaths,
      (path) => explainActive && !explainFolderFocused(explainFocus, path),
    )
    return {
      files,
      floors,
      bridges: collectMapBridgeItems(
        viewLayout.bridges.filter((bridge) => !overlayBridgeIds.has(bridge.id)),
        (id) => explainActive && !explainBridgeFocused(explainFocus, id),
      ),
    }
  }, [
    explainActive,
    overlayBridgeIds,
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
        notedFolderPaths={notedFolderPaths}
        notedFolderColors={notedFolderColors}
        fileLabels={mapFileLabels}
        focusBounds={focusBounds}
        focusFlightKey={focusFlightKey}
        revealBounds={revealBounds}
        revealFlightKey={revealFlightKey}
        hudReserve={88}
        topReserve={explainActive ? 24 : 28}
        landEnabled={landEnabled}
        droppingWalk={droppingWalk}
        dimmedFolderPaths={dimmedFolderPaths}
        onLand={onLand}
        onSelect={onSelect}
        onSelectFolder={onSelectFolder}
        pickingImport={pickingImport}
        onBlueprintMenu={
          mapping && !placing && onBlueprintMenu ? onBlueprintMenu : undefined
        }
        blueprintOpacity={overlayOpacity}
        blueprintSheets={blueprintSheets}
        folderLabelAnchors={folderLabelAnchors}
      />

      {mapping && (
        <MapBatches
          files={mapBatches.files}
          floors={mapBatches.floors}
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
            noted={notedFolders.has(folder.path)}
            notedColors={notedFolderColors[folder.path]}
            opacity={
              mapping && isBlueprintFolder(folder)
                ? capMapPieceOpacity(
                    explainItemOpacity(
                      explainActive &&
                        !explainFolderFocused(explainFocus, folder.path),
                    ),
                  )
                : explainItemOpacity(
                    explainActive &&
                      !explainFolderFocused(explainFocus, folder.path),
                  )
            }
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
        const layoutPlaced = viewLayout.files[file.id]
        if (!layoutPlaced) return null
        const underBlueprint = blueprintUnderlayIds.has(file.id)
        const placed = layoutPlaced
        const selected = file.id === selectedId
        const isRelated = related.has(file.id)
        const isPlanned = planned.has(file.id) || deleted.has(file.id)
        const changeKind = fileChangeKind(file.id, planned, created, deleted)
        const naming = file.id === namingId
        const aimed = file.id === aimedRelation?.flyTo
        const pointed = pointedFiles.has(file.id)
        const noted = notedFiles.has(file.id)
        const focused = explainFileHighlighted(explainFocus, file.id, file.folder)
        const detailed =
          selected ||
          isRelated ||
          isPlanned ||
          naming ||
          aimed ||
          pointed ||
          noted ||
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
            selected={selected && !underBlueprint}
            related={isRelated}
            planned={isPlanned}
            changeKind={changeKind}
            added={created.has(file.id) || file.userCreated}
            aimed={aimed}
            pointed={pointed && !mapping}
            pointedColors={mapping ? undefined : pointedFileColors[file.id]}
            noted={noted && !mapping}
            notedColors={mapping ? undefined : notedFileColors[file.id]}
            onOpenNote={onOpenFileNote}
            dimmed={dimmed}
            focused={focused && !underBlueprint}
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
            layout={groundLayout}
            selectedId={selectedId}
            selectedFolder={selectedFolder}
            selectedFolderLayer={selectedFolderLayer}
            namingId={namingId}
            namingIslandId={namingIslandId}
            pointedFiles={pointedFiles}
            pointedFileColors={pointedFileColors}
            notedFiles={notedFiles}
            notedFileColors={notedFileColors}
            onOpenNote={onOpenFileNote}
            explainActive={explainActive}
            explainFocus={explainFocus}
            overlayOpacity={overlayOpacity}
            planned={planned}
            created={created}
            deleted={deleted}
            bridges={viewLayout.bridges.filter((bridge) => {
              const child = bridge.id.split('→').pop()
              return (
                Boolean(child && createdFolderPaths.has(child)) &&
                Object.prototype.hasOwnProperty.call(layer.folders, child)
              )
            })}
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
            pointed={pointedFiles.has(file.id)}
            pointedColors={pointedFileColors[file.id]}
            noted={notedFiles.has(file.id)}
            notedColors={notedFileColors[file.id]}
            onOpenNote={onOpenFileNote}
            mapMode={mapping}
          />
        )
      })}
      {(explainEdges.length > 0 ||
        relationMode === 'all' ||
        relationMode === 'changed' ||
        (relationMode === 'targeted' && selectionFocus)) && (
        <RelationLines
          selectedId={relationMode === 'changed' ? null : selectedId}
          aimedRelation={aimedRelation}
          onAimRelation={mapping ? onAimRelation : undefined}
          files={viewGraph.files}
          layout={viewLayout}
          extras={relationAnchors}
          plannedIds={plannedIds}
          plannedEdges={plannedImports}
          extraEdges={explainEdges}
          fromAbove={mapping}
          importedBy={fileImportedBy}
          focusIds={folderFocusIds}
          drawPlanned={showAllPlanned}
          drawExisting={showExistingRelations}
        />
      )}
      <Player
        mode={mode}
        landAt={landAt}
        locked={locked}
        lockEnabled={!placing}
        onLockedChange={onLockedChange}
        onWalkPosition={onWalkPosition}
        onExitWalk={onExitWalk}
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

const COVER_DASH = 0.32
const COVER_GAP = 0.16
const COVER_STROKE = 0.11

function dashOffsets(length: number) {
  const step = COVER_DASH + COVER_GAP
  const count = Math.max(1, Math.round((length + COVER_GAP) / step))
  const span = count * COVER_DASH + Math.max(0, count - 1) * COVER_GAP
  const dash = COVER_DASH * (length / span)
  const gap = count > 1 ? COVER_GAP * (length / span) : 0
  const start = -length / 2
  const offsets: number[] = []
  for (let i = 0; i < count; i += 1) {
    offsets.push(start + dash / 2 + i * (dash + gap))
  }
  return { dash, offsets }
}

function DashedBlockOutline({
  width,
  depth,
  color,
  opacity,
}: {
  width: number
  depth: number
  color: string
  opacity: number
}) {
  const dashes = useMemo(() => {
    const across = dashOffsets(width)
    const down = dashOffsets(depth)
    const hw = width / 2
    const hd = depth / 2
    const pieces: Array<{ x: number; z: number; length: number; horizontal: boolean }> = []
    for (const offset of across.offsets) {
      pieces.push({ x: offset, z: -hd, length: across.dash, horizontal: true })
      pieces.push({ x: offset, z: hd, length: across.dash, horizontal: true })
    }
    for (const offset of down.offsets) {
      pieces.push({ x: -hw, z: offset, length: down.dash, horizontal: false })
      pieces.push({ x: hw, z: offset, length: down.dash, horizontal: false })
    }
    return pieces
  }, [depth, width])
  if (opacity <= 0) return null
  return (
    <group>
      {dashes.map((piece, index) => (
        <mesh
          key={index}
          position={[piece.x, 0, piece.z]}
          rotation={[-Math.PI / 2, 0, piece.horizontal ? 0 : Math.PI / 2]}
          renderOrder={5}
        >
          <planeGeometry args={[piece.length, COVER_STROKE]} />
          <meshBasicMaterial
            color={color}
            toneMapped={false}
            transparent
            opacity={opacity}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}

function fileInsideFolder(file: PlacedFile, folder: PlacedFolder) {
  const x = file.position[0]
  const z = file.position[2]
  return (
    Math.abs(x - folder.x) <= folder.width / 2 &&
    z >= folder.z &&
    z <= folder.z + folder.depth
  )
}

/** A bridge rises only when both ends are raised blueprint folders. */
function overlayBridgeY(layer: BlueprintOverlayLayer, bridge: PlacedBridge) {
  const ends = bridge.id.split('→')
  return Math.min(
    ...ends.map((path) => layer.folderHeights[path] ?? BLUEPRINT_OVERLAY.groundY),
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
  const pieces = useMemo(() => mapBridgeLine(bridge), [bridge])
  return (
    <group position={[0, y, 0]} visible={opacity > 0}>
      {pieces.map((piece) => (
        <mesh
          key={piece.key}
          position={[piece.x, 0, piece.z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[piece.width, piece.depth]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={opacity}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
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

/** Blueprint blocks keep the map footprint of a file already laid out, at the blueprint's height. */
function overlayFilePlacement(placed: PlacedFile, layoutFile?: PlacedFile): PlacedFile {
  if (!layoutFile) return placed
  return {
    ...placed,
    position: [layoutFile.position[0], placed.position[1], layoutFile.position[2]],
    size: layoutFile.size,
    aisleFace: layoutFile.aisleFace,
  }
}

/** Real map files under a blueprint folder, with the height of the sheet covering them. */
function filesUnderBlueprints(
  layout: WorldLayout,
  layers: BlueprintOverlayLayer[],
  namingIslandId: string | null,
): Map<string, number> {
  const covers: { bounds: PlacedFolder; y: number }[] = []
  for (const layer of layers) {
    for (const folder of Object.values(layer.folders)) {
      const bounds = overlayFolderBounds(
        folder,
        layout.folders,
        folder.path === namingIslandId,
      )
      if (bounds) covers.push({ bounds, y: overlayFolderY(layer, folder.path) })
    }
  }
  const under = new Map<string, number>()
  if (covers.length === 0) return under
  for (const [id, file] of Object.entries(layout.files)) {
    for (const cover of covers) {
      if (!fileInsideFolder(file, cover.bounds)) continue
      under.set(id, Math.max(under.get(id) ?? -Infinity, cover.y))
    }
  }
  return under
}

function flattenFilesUnderBlueprints(
  layout: WorldLayout,
  under: Map<string, number>,
): WorldLayout {
  if (under.size === 0) return layout
  const height = BLUEPRINT_OVERLAY.coveredFileHeight
  let files: Record<string, PlacedFile> | null = null
  for (const [id, file] of Object.entries(layout.files)) {
    if (!under.has(id)) continue
    files ??= { ...layout.files }
    files[id] = {
      ...file,
      position: [file.position[0], height / 2, file.position[2]],
      size: [file.size[0], height, file.size[2]],
    }
  }
  return files ? { ...layout, files } : layout
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
  notedFiles,
  notedFileColors,
  onOpenNote,
  explainActive,
  explainFocus,
  overlayOpacity,
  planned,
  created,
  deleted,
  bridges = [],
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
  notedFiles: Set<string>
  notedFileColors: Record<string, string[]>
  onOpenNote?: (fileId: string, color?: string) => void
  explainActive: boolean
  explainFocus: ExplainFocus | null
  overlayOpacity: number
  planned: Set<string>
  created: Set<string>
  deleted: Set<string>
  bridges?: PlacedBridge[]
}) {
  const filled = new Set(layer.filledIds)
  const filesById = new Map(graph.files.map((file) => [file.id, file]))
  const tint = blueprintPalette(layer.colorHex)
  const isMapFile = (id: string) => {
    const node = filesById.get(id)
    return Boolean(layout.files[id] && node && !node.userCreated)
  }
  const coveredFiles = Object.values(layout.files).filter((file) => {
    const node = filesById.get(file.id)
    if (node?.userCreated) return false
    return Object.values(layer.folders).some((folder) => {
      const bounds = overlayFolderBounds(
        folder,
        layout.folders,
        folder.path === namingIslandId,
      )
      return bounds ? fileInsideFolder(file, bounds) : false
    })
  })

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
            overlayY={overlayFolderY(layer, folder.path)}
            sheetOpacity={BLUEPRINT_OVERLAY.folderOpacity}
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
      {[...layer.bridges, ...bridges.filter((bridge) => !layer.bridges.some((item) => item.id === bridge.id))].map((bridge) => (
        <OverlayBridgeStrip
          key={`overlay-bridge:${layer.id}:${bridge.id}`}
          bridge={bridge}
          color={tint.color}
          y={overlayBridgeY(layer, bridge)}
          opacity={capMapPieceOpacity(
            explainItemOpacity(
              explainActive && !explainBridgeFocused(explainFocus, bridge.id),
              overlayOpacity,
            ),
          )}
        />
      ))}
      {Object.entries(layer.files).map(([id, placed]) => {
        if (isMapFile(id)) return null
        const existing = filesById.get(id)
        const overlayPlaced = overlayFilePlacement(placed, layout.files[id])
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
        const realFile = Boolean(existing && !existing.userCreated)
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
            changeKind={
              fileChangeKind(id, planned, created, deleted) ??
              (realFile ? null : 'add')
            }
            added={!realFile}
            overlay
            overlayFilled={realFile || isFilled}
            pointed={pointedFiles.has(id)}
            pointedColors={pointedFileColors[id]}
            noted={notedFiles.has(id)}
            notedColors={notedFileColors[id]}
            onOpenNote={onOpenNote}
            dimmed={dimmed}
            focused={explainFileHighlighted(explainFocus, id, file.folder)}
            opacity={explainItemOpacity(dimmed, overlayOpacity)}
            naming={id === namingId}
            mapMode
            labelVisible={false}
          />
        )
      })}
      {Object.entries(layout.files).map(([id, layoutFile]) => {
        if (layer.files[id] && !isMapFile(id)) return null
        const hex = layer.colorHex.toLowerCase()
        const noteColors = (notedFileColors[id] ?? []).filter(
          (color) => color.toLowerCase() === hex,
        )
        const eyeColors = (pointedFileColors[id] ?? []).filter(
          (color) => color.toLowerCase() === hex,
        )
        if (noteColors.length === 0 && eyeColors.length === 0) return null
        const opacity = explainItemOpacity(
          explainActive &&
            !explainFileFocused(explainFocus, id, folderOfFile(id)),
          overlayOpacity,
        )
        return (
          <group
            key={`overlay-marks:${layer.id}:${id}`}
            position={[
              layoutFile.position[0],
              overlayFolderY(layer, folderOfFile(id)),
              layoutFile.position[2],
            ]}
            visible={opacity > 0}
          >
            <FileMarks
              mapMode
              width={layoutFile.size[0]}
              depth={layoutFile.size[2]}
              height={0}
              noteColors={noteColors}
              eyeColors={eyeColors}
              fileName={id.split('/').pop() ?? id}
              opacity={opacity}
              onOpen={
                onOpenNote && !id.startsWith('draft:')
                  ? (color) => onOpenNote(id, color)
                  : undefined
              }
            />
          </group>
        )
      })}
      {coveredFiles.map((file) => {
        const opacity = explainItemOpacity(
          explainActive &&
            !explainFileFocused(explainFocus, file.id, folderOfFile(file.id)),
          overlayOpacity,
        )
        return (
          <group
            key={`covered-file:${layer.id}:${file.id}`}
            position={[
              file.position[0],
              overlayFolderY(layer, folderOfFile(file.id)) + 0.12,
              file.position[2],
            ]}
            visible={opacity > 0}
          >
            <DashedBlockOutline
              width={file.size[0]}
              depth={file.size[2]}
              color="#f4f7fb"
              opacity={opacity}
            />
          </group>
        )
      })}
    </group>
  )
}
