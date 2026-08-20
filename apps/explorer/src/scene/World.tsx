import { FolderArea } from './FolderArea'
import { FileBlock } from './FileBlock'
import { Bridge } from './Bridge'
import { RelationLines } from './RelationLines'
import { Player } from './Player'
import { MapView } from './MapView'
import { SelectionController } from './SelectionController'
import { UserContextTracker } from './UserContextTracker'
import { BlockPlacer } from './BlockPlacer'
import { IslandPlacer } from './IslandPlacer'
import { folderOfFile, filesImporting } from '../layout'
import { EDITOR_GREY } from '../theme'
import type { ChangeKind } from '../theme'
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
  onFolderChange: (label: string) => void
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
  onTravelTo: (fromId: string, toId: string) => void
  importedBy?: boolean
  namingId?: string | null
  onPlaceBlock?: (spot: { x: number; z: number; folder: string }) => void
  onPlaceIsland?: (parent: string) => void
  onCommitName?: (id: string, name: string) => boolean
  onCancelName?: (id: string) => void
  userCreatedBlocks?: UserCreatedBlock[]
  userCreatedIslands?: UserCreatedIsland[]
  namingIslandId?: string | null
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
  onFolderChange,
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
  onTravelTo,
  importedBy = false,
  namingId = null,
  namingIslandId = null,
  onPlaceBlock,
  onPlaceIsland,
  onCommitName,
  onCancelName,
  userCreatedBlocks = [],
  userCreatedIslands = [],
}: WorldProps) {
  const created = new Set(createdIds)
  const deleted = new Set(deletedIds)
  const mapping = mode === 'map'
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
  const highlightedFolders: Partial<Record<string, ChangeKind>> = {}
  const folderKinds = new Map<string, Set<ChangeKind>>()
  const addFolderKind = (id: string, kind: ChangeKind) => {
    const folder = folderOfFile(id)
    const kinds = folderKinds.get(folder) ?? new Set<ChangeKind>()
    kinds.add(kind)
    folderKinds.set(folder, kinds)
  }
  for (const id of planned) {
    addFolderKind(id, created.has(id) ? 'add' : 'edit')
  }
  for (const id of deleted) addFolderKind(id, 'remove')
  for (const [folder, kinds] of folderKinds) {
    if (kinds.size === 1) highlightedFolders[folder] = [...kinds][0]
  }
  if (planned.size > 0 || deleted.size > 0) {
    for (const folder of Object.values(layout.folders)) {
      if (!folder.added) continue
      const kinds = folderKinds.get(folder.path)
      if (!kinds || kinds.size === 1) {
        highlightedFolders[folder.path] ??= 'add'
      }
    }
  }

  const changeKindOf = (id: string): ChangeKind | null => {
    if (deleted.has(id)) return 'remove'
    if (created.has(id)) return 'add'
    if (planned.has(id)) return 'edit'
    return null
  }

  return (
    <>
      <color attach="background" args={[EDITOR_GREY.editor]} />
      {!mapping && <fog attach="fog" args={[EDITOR_GREY.editor, 38, 160]} />}
      <hemisphereLight args={['#d7e2ee', '#2a3038', mapping ? 1.1 : 0.85]} />
      <directionalLight
        position={mapping ? [8, 60, 8] : [12, 22, 8]}
        intensity={mapping ? 1.35 : 0.55}
      />
      <ambientLight intensity={mapping ? 0.7 : 0.42} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 40]}>
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial color={EDITOR_GREY.chrome} />
      </mesh>
      <MapView
        layout={layout}
        enabled={mapping}
        marker={landAt}
        highlightedFolders={highlightedFolders}
        selectedFolder={selectedFolder}
        onLand={onLand}
        onSelect={onSelect}
        onSelectFolder={onSelectFolder}
        onTravelTo={onTravelTo}
      />

      {Object.values(layout.folders).map((folder) => (
        <FolderArea
          key={folder.path}
          folder={folder}
          naming={folder.path === namingIslandId}
          selected={folder.path === selectedFolder}
          highlightKind={highlightedFolders[folder.path] ?? null}
        />
      ))}
      {layout.bridges.map((bridge) => (
        <Bridge key={bridge.id} bridge={bridge} />
      ))}
      {graph.files.map((file) => {
        const placed = layout.files[file.id]
        if (!placed) return null
        const selected = file.id === selectedId
        const isRelated = related.has(file.id)
        const isPlanned = planned.has(file.id) || deleted.has(file.id)
        const changeKind = changeKindOf(file.id)
        const naming = file.id === namingId
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
            aimed={file.id === aimedRelation?.flyTo}
            dimmed={
              hasFocus &&
              !selected &&
              !isRelated &&
              !changeKind &&
              !patchLinked.has(file.id) &&
              !folderFileIds.has(file.id)
            }
            naming={naming}
            mapMode={mapping}
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
        files={graph.files}
        layout={layout}
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
        onFolderChange={onFolderChange}
        onWalkPosition={onWalkPosition}
        flyTo={flyTo}
      />
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
