import { BLUEPRINT_OVERLAY, CONFIG, fileHeight } from './theme'
import { folderOfFile, folderParent } from './layout'
import type {
  BlueprintNote,
  BlueprintNoteKind,
  BlueprintPointer,
  BlueprintPointerKind,
  CodebaseGraph,
  FileNode,
  PatchImportAddition,
  PatchSymbolAddition,
  PlacedBridge,
  PlacedFile,
  PlacedFolder,
  UserCreatedBlock,
  UserCreatedIsland,
  WorldLayout,
} from './types'

export type BlueprintLayerSource = {
  id: string
  hex: string
  blocks: UserCreatedBlock[]
  islands: UserCreatedIsland[]
}

export type BlueprintOverlayLayer = {
  id: string
  colorHex: string
  folders: Record<string, PlacedFolder>
  files: Record<string, PlacedFile>
  bridges: PlacedBridge[]
  filledIds: string[]
  folderY: number
  fileLift: number
}

export function languageOfName(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  return ext && ext !== name ? ext : 'txt'
}

export function toCreatedFile(block: UserCreatedBlock): FileNode {
  const name = block.naming && !block.name ? 'New file' : block.name
  return {
    id: block.id,
    name,
    path: block.path || block.id,
    folder: block.folder,
    lines: 12,
    language: languageOfName(name),
    symbols: [],
    imports: [],
    userCreated: true,
    colorHex: block.colorHex,
  }
}

export function namedCreatedBlocks(blocks: UserCreatedBlock[]) {
  return blocks.filter((block) => !block.naming && Boolean(block.name))
}

export function namedCreatedIslands(islands: UserCreatedIsland[]) {
  return islands.filter((island) => !island.naming && Boolean(island.name))
}

export function parseUserCreatedBlocks(value: unknown): UserCreatedBlock[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const block = item as Partial<UserCreatedBlock>
    if (
      typeof block.id !== 'string' ||
      typeof block.name !== 'string' ||
      typeof block.path !== 'string' ||
      typeof block.folder !== 'string' ||
      typeof block.x !== 'number' ||
      typeof block.z !== 'number'
    ) {
      return []
    }
    return [
      {
        id: block.id,
        name: block.name,
        path: block.path,
        folder: block.folder,
        x: block.x,
        z: block.z,
      },
    ]
  })
}

export function parseUserCreatedIslands(value: unknown): UserCreatedIsland[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const island = item as Partial<UserCreatedIsland>
    if (
      typeof island.id !== 'string' ||
      typeof island.name !== 'string' ||
      typeof island.path !== 'string' ||
      typeof island.parent !== 'string'
    ) {
      return []
    }
    return [
      {
        id: island.id,
        name: island.name,
        path: island.path,
        parent: island.parent,
      },
    ]
  })
}

export function resolveCreatedFile(rawName: string, folder: string) {
  const trimmed = rawName.trim().replaceAll('\\', '/').replace(/^\.\//, '')
  if (!trimmed) return null
  const path = trimmed.includes('/')
    ? trimmed.replace(/^\/+/, '').replace(/\/+/g, '/')
    : folder === '.'
      ? trimmed
      : `${folder}/${trimmed}`
  const name = path.split('/').pop() ?? path
  if (!name) return null
  return {
    id: path,
    name,
    path,
    folder: folderOfFile(path),
  }
}

export function resolveCreatedIsland(rawName: string, parent: string) {
  const trimmed = rawName
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '')
  if (!trimmed) return null
  const path = trimmed.includes('/')
    ? trimmed.replace(/^\/+/, '').replace(/\/+/g, '/')
    : parent === '.'
      ? trimmed
      : `${parent}/${trimmed}`
  const name = path.split('/').pop() ?? path
  if (!name) return null
  return {
    id: path,
    name,
    path,
    parent: folderParent(path) ?? '.',
  }
}

export function createdIslandKey(island: Pick<UserCreatedIsland, 'id' | 'path'>) {
  return island.path || island.id
}

function islandKey(island: UserCreatedIsland) {
  return createdIslandKey(island)
}

export function pathIsInside(path: string, parent: string) {
  if (!path || !parent) return false
  if (path === parent) return true
  if (parent === '.') return path !== '.'
  return path.startsWith(`${parent}/`)
}

export function createdItemsInsideFolder(
  folderPath: string,
  blocks: UserCreatedBlock[],
  islands: UserCreatedIsland[],
) {
  const removedIslands = islands.filter((island) =>
    pathIsInside(createdIslandKey(island), folderPath),
  )
  const removedBlocks = blocks.filter(
    (block) =>
      pathIsInside(block.folder, folderPath) ||
      pathIsInside(block.path || block.id, folderPath),
  )
  return { removedBlocks, removedIslands }
}

function islandWidth() {
  const fileOffset = CONFIG.aisleWidth / 2 + CONFIG.fileWidth / 2 + 0.7
  const fileOuter = fileOffset + CONFIG.fileWidth / 2
  return (fileOuter + 1.1) * 2
}

function islandDepth() {
  return CONFIG.areaPadding * 2 + CONFIG.fileSpacing
}

export function withUserCreatedGraph(
  graph: CodebaseGraph,
  blocks: UserCreatedBlock[],
  islands: UserCreatedIsland[] = [],
): CodebaseGraph {
  if (blocks.length === 0 && islands.length === 0) return graph
  const files = new Map(graph.files.map((file) => [file.id, file]))
  const folders = new Map(
    graph.folders.map((folder) => [
      folder.path,
      { ...folder, files: [...folder.files], children: [...folder.children] },
    ]),
  )

  for (const island of islands) {
    const path = islandKey(island)
    if (folders.has(path)) continue
    const parent = island.parent || folderParent(path)
    folders.set(path, {
      path,
      name: island.naming && !island.name ? 'New folder' : island.name,
      parent,
      files: [],
      children: [],
      userCreated: true,
      colorHex: island.colorHex,
    })
    if (parent) {
      const parentFolder = folders.get(parent)
      if (parentFolder && !parentFolder.children.includes(path)) {
        parentFolder.children.push(path)
      }
    }
  }

  for (const block of blocks) {
    if (files.has(block.id)) continue
    const file = toCreatedFile(block)
    files.set(file.id, file)
    const folder = folders.get(file.folder)
    if (folder && !folder.files.includes(file.id)) folder.files.push(file.id)
  }

  return {
    ...graph,
    files: [...files.values()],
    folders: [...folders.values()],
  }
}

function placedFolderParent(
  folder: PlacedFolder,
  islands: UserCreatedIsland[],
) {
  const created = islands.find((item) => islandKey(item) === folder.path)
  if (created) return created.parent
  return folderParent(folder.path)
}

function expandFolderWidthToChildren(
  folder: PlacedFolder,
  children: PlacedFolder[],
): PlacedFolder | null {
  let left = folder.x - folder.width / 2
  let right = folder.x + folder.width / 2
  const startLeft = left
  const startRight = right
  for (const child of children) {
    left = Math.min(left, child.x - child.width / 2)
    right = Math.max(right, child.x + child.width / 2)
  }
  if (left >= startLeft - 1e-6 && right <= startRight + 1e-6) return null
  return {
    ...folder,
    x: (left + right) / 2,
    width: right - left,
  }
}

function ancestorPaths(start: string | null) {
  const paths: string[] = []
  let current = start
  while (current) {
    paths.push(current)
    current = folderParent(current)
  }
  return paths
}

function expandParentsToChildren(
  folders: Record<string, PlacedFolder>,
  islands: UserCreatedIsland[],
) {
  const parentPaths = new Set<string>()
  for (const island of islands) {
    for (const path of ancestorPaths(island.parent)) parentPaths.add(path)
  }
  const ordered = [...parentPaths].sort(
    (left, right) =>
      right.split('/').filter(Boolean).length -
      left.split('/').filter(Boolean).length,
  )
  for (const parentPath of ordered) {
    const parent = folders[parentPath]
    if (!parent) continue
    const children = Object.values(folders).filter(
      (folder) =>
        folder.path !== parentPath &&
        placedFolderParent(folder, islands) === parentPath,
    )
    if (children.length === 0) continue
    const expanded = expandFolderWidthToChildren(parent, children)
    if (expanded) folders[parentPath] = expanded
  }
}

function overlayIslands(
  layout: WorldLayout,
  islands: UserCreatedIsland[],
): WorldLayout {
  if (islands.length === 0) return layout
  const folders = { ...layout.folders }
  const bridges = [...layout.bridges]
  const width = islandWidth()
  const depth = islandDepth()

  for (const island of islands) {
    const id = islandKey(island)
    if (layout.folders[id]) {
      folders[id] = {
        ...folders[id],
        added: true,
        userCreated: true,
        name: island.name || folders[id].name,
        colorHex: island.colorHex ?? folders[id].colorHex,
      }
      continue
    }
    const parentPath = island.parent
    const parent = folders[parentPath]
    if (!parent) continue
    const siblings = Object.values(folders).filter((folder) => {
      if (folder.path === id) return false
      const placedIsland = islands.find((item) => islandKey(item) === folder.path)
      const folderParentPath = placedIsland?.parent ?? folderParent(folder.path)
      return folderParentPath === parentPath
    })
    const x =
      siblings.length === 0
        ? parent.x
        : Math.max(...siblings.map((folder) => folder.x + folder.width / 2)) +
          CONFIG.siblingGap +
          width / 2
    const z = parent.z + parent.depth + CONFIG.bridgeLength
    folders[id] = {
      path: id,
      name: island.naming && !island.name ? 'New folder' : island.name,
      x,
      z,
      width,
      depth,
      added: true,
      userCreated: true,
      colorHex: island.colorHex,
    }
    bridges.push({
      id: `${parentPath}→${id}`,
      label: folders[id].name,
      fromLabel: parent.name,
      points: [
        [x, parent.z + parent.depth - CONFIG.bridgeOverlap],
        [x, z + CONFIG.bridgeOverlap],
      ],
    })
  }

  expandParentsToChildren(folders, islands)
  return { ...layout, folders, bridges }
}

export function withUserCreatedLayout(
  layout: WorldLayout,
  blocks: UserCreatedBlock[],
  islands: UserCreatedIsland[] = [],
): WorldLayout {
  const withIslands = overlayIslands(layout, islands)
  if (blocks.length === 0) return withIslands
  const files = { ...withIslands.files }
  const height = fileHeight(12)
  for (const block of blocks) {
    const folder = withIslands.folders[block.folder]
    files[block.id] = {
      id: block.id,
      position: [block.x, height / 2, block.z],
      size: [CONFIG.fileWidth, height, CONFIG.fileDepth],
      aisleFace: folder && block.x >= folder.x ? -1 : 1,
    }
  }
  return { ...withIslands, files }
}

function uniqueSiblings(
  folders: PlacedFolder[],
  parentPath: string,
  selfPath: string,
  islands: UserCreatedIsland[],
) {
  const seen = new Set<string>()
  const siblings: PlacedFolder[] = []
  for (const folder of folders) {
    if (folder.path === selfPath || seen.has(folder.path)) continue
    const placedIsland = islands.find((item) => islandKey(item) === folder.path)
    const folderParentPath = placedIsland?.parent ?? folderParent(folder.path)
    if (folderParentPath !== parentPath) continue
    seen.add(folder.path)
    siblings.push(folder)
  }
  return siblings
}

function overlayNameOf(island: UserCreatedIsland) {
  return island.naming && !island.name ? 'New folder' : island.name
}

type OccupiedRect = {
  left: number
  right: number
  top: number
  bottom: number
}

function folderOccupancy(folder: PlacedFolder): OccupiedRect {
  return {
    left: folder.x - folder.width / 2,
    right: folder.x + folder.width / 2,
    top: folder.z,
    bottom: folder.z + folder.depth,
  }
}

function fileOccupancy(file: PlacedFile): OccupiedRect {
  return {
    left: file.position[0] - file.size[0] / 2,
    right: file.position[0] + file.size[0] / 2,
    top: file.position[2] - file.size[2] / 2,
    bottom: file.position[2] + file.size[2] / 2,
  }
}

function occupancyOverlaps(left: OccupiedRect, right: OccupiedRect) {
  return (
    left.left < right.right &&
    left.right > right.left &&
    left.top < right.bottom &&
    left.bottom > right.top
  )
}

function mapOccupancy(
  base: WorldLayout,
  overlayFolders: Record<string, PlacedFolder>,
  overlayFiles: Record<string, PlacedFile>,
  skipFolderPath?: string,
  skipFileId?: string,
) {
  const rects: OccupiedRect[] = []
  for (const folder of Object.values(base.folders)) {
    if (folder.path === skipFolderPath) continue
    rects.push(folderOccupancy(folder))
  }
  for (const folder of Object.values(overlayFolders)) {
    if (folder.path === skipFolderPath) continue
    rects.push(folderOccupancy(folder))
  }
  for (const file of Object.values(base.files)) {
    if (file.id === skipFileId) continue
    rects.push(fileOccupancy(file))
  }
  for (const file of Object.values(overlayFiles)) {
    if (file.id === skipFileId) continue
    rects.push(fileOccupancy(file))
  }
  return rects
}

function shiftToEmptyMapSpace(folder: PlacedFolder, occupied: OccupiedRect[]) {
  let next = folder
  const gap = CONFIG.siblingGap
  for (let step = 0; step < 80; step += 1) {
    const rect = folderOccupancy(next)
    const hit = occupied.find((other) => occupancyOverlaps(rect, other))
    if (!hit) return next
    next = {
      ...next,
      x: hit.right + gap + next.width / 2,
    }
  }
  return next
}

function existingFolderWithName(
  folders: PlacedFolder[],
  parentPath: string,
  name: string,
  islands: UserCreatedIsland[],
) {
  const needle = name.trim()
  if (!needle || needle === 'New folder') return null
  return (
    folders.find((folder) => {
      if (folder.name !== needle) return false
      return placedFolderParent(folder, islands) === parentPath
    }) ?? null
  )
}

function existingFileWithName(
  files: Record<string, PlacedFile>,
  folderPath: string,
  name: string,
) {
  const needle = name.trim()
  if (!needle || needle === 'New file') return null
  for (const file of Object.values(files)) {
    if (folderOfFile(file.id) !== folderPath) continue
    if ((file.id.split('/').pop() ?? file.id) === needle) return file
  }
  return null
}
function overlayMatchesExistingFolder(
  island: UserCreatedIsland,
  existing: PlacedFolder,
) {
  if (islandKey(island) !== existing.path) return false
  if (island.naming || !island.name) return true
  return island.name === existing.name
}

function overlayMatchesExistingFile(block: UserCreatedBlock, fileId: string) {
  if (block.id !== fileId) return false
  if (block.naming || !block.name) return true
  return block.name === (fileId.split('/').pop() ?? fileId)
}

function overlayAwareFolders(
  base: WorldLayout,
  overlay: Record<string, PlacedFolder>,
) {
  const paths = new Set([
    ...Object.keys(base.folders),
    ...Object.keys(overlay),
  ])
  return [...paths].map((path) => overlay[path] ?? base.folders[path])
}

function expandOverlayParents(
  folders: Record<string, PlacedFolder>,
  base: WorldLayout,
  islands: UserCreatedIsland[],
  colorHex: string,
) {
  const parentPaths = new Set<string>()
  for (const island of islands) {
    const id = islandKey(island)
    if (base.folders[id]) continue
    for (const path of ancestorPaths(island.parent)) parentPaths.add(path)
  }
  const ordered = [...parentPaths].sort(
    (left, right) =>
      right.split('/').filter(Boolean).length -
      left.split('/').filter(Boolean).length,
  )
  for (const parentPath of ordered) {
    const current = folders[parentPath] ?? base.folders[parentPath]
    if (!current) continue
    const children = uniqueSiblings(
      overlayAwareFolders(base, folders),
      parentPath,
      parentPath,
      islands,
    )
    if (children.length === 0) continue
    const expanded = expandFolderWidthToChildren(current, children)
    if (!expanded) continue
    const already = folders[parentPath]
    folders[parentPath] = {
      ...expanded,
      overlay: true,
      colorHex: already?.colorHex ?? colorHex,
      added: already?.added,
    }
  }
}

function placeOverlayIslands(
  base: WorldLayout,
  islands: UserCreatedIsland[],
  colorHex: string,
): { folders: Record<string, PlacedFolder>; bridges: PlacedBridge[] } {
  const folders: Record<string, PlacedFolder> = {}
  const bridges: PlacedBridge[] = []
  const width = islandWidth()
  const depth = islandDepth()
  const lookup = (path: string) => folders[path] ?? base.folders[path]

  for (const island of islands) {
    const id = islandKey(island)
    const name = overlayNameOf(island)
    const existingByPath = base.folders[id]
    if (existingByPath && overlayMatchesExistingFolder(island, existingByPath)) {
      folders[id] = {
        ...existingByPath,
        overlay: true,
        colorHex,
      }
      continue
    }
    const existingByName = island.naming
      ? null
      : existingFolderWithName(
          overlayAwareFolders(base, folders),
          island.parent,
          name,
          islands,
        )
    if (existingByName) {
      folders[id] = {
        ...existingByName,
        path: existingByName.path,
        overlay: true,
        colorHex,
      }
      continue
    }
    const parentPath = island.parent
    const parent = lookup(parentPath)
    if (!parent) continue
    const siblings = uniqueSiblings(
      [...Object.values(base.folders), ...Object.values(folders)],
      parentPath,
      id,
      islands,
    )
    const x =
      siblings.length === 0
        ? parent.x
        : Math.max(...siblings.map((folder) => folder.x + folder.width / 2)) +
          CONFIG.siblingGap +
          width / 2
    const z = parent.z + parent.depth + CONFIG.bridgeLength
    const placed = shiftToEmptyMapSpace(
      {
        path: id,
        name,
        x,
        z,
        width,
        depth,
        added: true,
        overlay: true,
        userCreated: true,
        colorHex,
      },
      mapOccupancy(base, folders, {}, id),
    )
    folders[id] = placed
    bridges.push({
      id: `${parentPath}→${id}`,
      label: placed.name,
      fromLabel: parent.name,
      points: [
        [placed.x, parent.z + parent.depth - CONFIG.bridgeOverlap],
        [placed.x, placed.z + CONFIG.bridgeOverlap],
      ],
    })
  }

  expandOverlayParents(folders, base, islands, colorHex)
  return { folders, bridges }
}

function baseFileCountInFolder(base: WorldLayout, folderPath: string) {
  let count = 0
  for (const file of Object.values(base.files)) {
    if (folderOfFile(file.id) === folderPath) count += 1
  }
  return count
}

function placeOverlayBlocks(
  base: WorldLayout,
  overlayFolders: Record<string, PlacedFolder>,
  blocks: UserCreatedBlock[],
  fileLift: number,
): { files: Record<string, PlacedFile>; filledIds: string[] } {
  const files: Record<string, PlacedFile> = {}
  const filledIds: string[] = []
  const height = fileHeight(12)
  const nextIndex = new Map<string, number>()
  const foldersForSpot: WorldLayout = {
    ...base,
    folders: { ...base.folders, ...overlayFolders },
  }
  for (const block of blocks) {
    const existingById = !block.naming ? base.files[block.id] : undefined
    if (existingById && overlayMatchesExistingFile(block, existingById.id)) {
      filledIds.push(block.id)
      files[block.id] = {
        ...existingById,
        position: [
          existingById.position[0],
          fileLift + existingById.size[1] / 2,
          existingById.position[2],
        ],
      }
      continue
    }
    const existingByName =
      !block.naming && block.name
        ? existingFileWithName(base.files, block.folder, block.name) ??
          existingFileWithName(files, block.folder, block.name)
        : null
    if (existingByName) {
      filledIds.push(existingByName.id)
      files[block.id] = {
        ...existingByName,
        position: [
          existingByName.position[0],
          fileLift + existingByName.size[1] / 2,
          existingByName.position[2],
        ],
      }
      continue
    }
    const folderPath = block.folder
    const folder = overlayFolders[folderPath] ?? base.folders[folderPath]
    const index =
      nextIndex.get(folderPath) ?? baseFileCountInFolder(base, folderPath)
    nextIndex.set(folderPath, index + 1)
    const spot = folder
      ? defaultBlockSpot(foldersForSpot, folderPath, index)
      : { x: block.x, z: block.z, folder: folderPath }
    let x = spot?.x ?? block.x
    const z = spot?.z ?? block.z
    const candidate: PlacedFile = {
      id: block.id,
      position: [x, fileLift + height / 2, z],
      size: [CONFIG.fileWidth, height, CONFIG.fileDepth],
      aisleFace: folder && x >= folder.x ? -1 : 1,
    }
    const occupied = mapOccupancy(base, overlayFolders, files, undefined, block.id)
    for (let step = 0; step < 40; step += 1) {
      const rect = fileOccupancy(candidate)
      const hit = occupied.find((other) => occupancyOverlaps(rect, other))
      if (!hit) break
      x = hit.right + CONFIG.siblingGap + CONFIG.fileWidth / 2
      candidate.position = [x, candidate.position[1], candidate.position[2]]
      candidate.aisleFace = folder && x >= folder.x ? -1 : 1
    }
    files[block.id] = candidate
  }
  return { files, filledIds }
}

function islandsForOverlay(
  blocks: UserCreatedBlock[],
  islands: UserCreatedIsland[],
  base: WorldLayout,
) {
  const have = new Set(islands.map((island) => islandKey(island)))
  const implied: UserCreatedIsland[] = []
  for (const block of blocks) {
    const folder = block.folder
    if (!folder || have.has(folder)) continue
    have.add(folder)
    const existing = base.folders[folder]
    implied.push({
      id: folder,
      name: existing?.name ?? (folder.split('/').pop() ?? folder),
      path: folder,
      parent: folderParent(folder) ?? '.',
    })
  }
  return [...islands, ...implied]
}

export function layoutBlueprintLayers(
  base: WorldLayout,
  sources: BlueprintLayerSource[],
): BlueprintOverlayLayer[] {
  return sources.map((source, index) => {
    const { folders, bridges } = placeOverlayIslands(
      base,
      islandsForOverlay(source.blocks, source.islands, base),
      source.hex,
    )
    const folderY =
      BLUEPRINT_OVERLAY.folderY + index * BLUEPRINT_OVERLAY.layerStep
    const fileLift = folderY + BLUEPRINT_OVERLAY.fileLift
    const { files, filledIds } = placeOverlayBlocks(
      base,
      folders,
      source.blocks,
      fileLift,
    )
    return {
      id: source.id,
      colorHex: source.hex,
      folders,
      files,
      bridges,
      filledIds,
      folderY,
      fileLift,
    }
  })
}

export function mergeOverlayOnlyFolders(
  layout: WorldLayout,
  layers: BlueprintOverlayLayer[],
): WorldLayout {
  const folders = { ...layout.folders }
  const bridges = [...layout.bridges]
  const seenBridges = new Set(bridges.map((bridge) => bridge.id))
  for (const layer of layers) {
    for (const folder of Object.values(layer.folders)) {
      if (layout.folders[folder.path]) {
        folders[folder.path] = {
          ...folders[folder.path],
          colorHex: folder.colorHex ?? folders[folder.path].colorHex,
          userCreated:
            folders[folder.path].userCreated || folder.userCreated,
        }
        continue
      }
      folders[folder.path] = folder
    }
    for (const bridge of layer.bridges) {
      if (seenBridges.has(bridge.id)) continue
      seenBridges.add(bridge.id)
      bridges.push(bridge)
    }
  }
  return { ...layout, folders, bridges }
}

export function defaultBlockSpot(
  layout: WorldLayout,
  folderPath: string,
  fileIndex: number,
): { x: number; z: number; folder: string } | null {
  const folder = layout.folders[folderPath]
  if (!folder) return null
  const side: 1 | -1 = fileIndex % 2 === 0 ? -1 : 1
  const row = Math.floor(fileIndex / 2)
  return {
    x: folder.x + side * (CONFIG.aisleWidth / 2 + CONFIG.fileWidth / 2 + 0.7),
    z: folder.z + CONFIG.areaPadding + row * CONFIG.fileSpacing,
    folder: folderPath,
  }
}

export function isBlueprintSymbolName(value: string) {
  return /^[A-Za-z_$][\w$]*$/.test(value.trim())
}

export function blueprintNoteKey(
  note: Pick<BlueprintNote, 'file' | 'kind' | 'name'>,
) {
  return note.kind === 'file'
    ? `file:${note.file}`
    : `${note.kind}:${note.file}:${note.name ?? ''}`
}

function parseBlueprintNote(value: unknown): BlueprintNote | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<BlueprintNote>
  const file = typeof item.file === 'string' ? item.file.trim() : ''
  const note = typeof item.note === 'string' ? item.note : ''
  if (!file || !note.trim()) return null
  if (item.kind === 'file') return { file, kind: 'file', note }
  if (item.kind !== 'function' && item.kind !== 'variable') return null
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  if (!name) return null
  return { file, kind: item.kind, name, note }
}

export function parseBlueprintNotes(value: unknown): BlueprintNote[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const notes: BlueprintNote[] = []
  for (const item of value) {
    const parsed = parseBlueprintNote(item)
    if (!parsed) continue
    const key = blueprintNoteKey(parsed)
    if (seen.has(key)) continue
    seen.add(key)
    notes.push(parsed)
  }
  return notes
}

export function findBlueprintNote(
  notes: BlueprintNote[],
  file: string,
  kind: BlueprintNoteKind,
  name?: string,
) {
  return (
    notes.find((item) =>
      kind === 'file'
        ? item.kind === 'file' && item.file === file
        : item.kind === kind && item.file === file && item.name === name,
    )?.note ?? ''
  )
}

export function setBlueprintNote(
  notes: BlueprintNote[],
  next: {
    file: string
    kind: BlueprintNoteKind
    name?: string
    note: string
  },
): BlueprintNote[] {
  const key = blueprintNoteKey(next)
  const without = notes.filter((item) => blueprintNoteKey(item) !== key)
  if (next.note === '') return without
  const stored: BlueprintNote =
    next.kind === 'file'
      ? { file: next.file, kind: 'file', note: next.note }
      : {
          file: next.file,
          kind: next.kind,
          name: (next.name ?? '').trim(),
          note: next.note,
        }
  if (stored.kind !== 'file' && !stored.name) return without
  return [...without, stored]
}

export function dropBlueprintFileNotes(
  notes: BlueprintNote[],
  fileIds: Iterable<string>,
) {
  const removed = new Set(fileIds)
  return notes.filter((item) => !removed.has(item.file))
}

export function dropBlueprintSymbolNote(
  notes: BlueprintNote[],
  file: string,
  kind: 'function' | 'variable',
  name: string,
) {
  return notes.filter(
    (item) =>
      !(item.file === file && item.kind === kind && item.name === name),
  )
}

export function blueprintPointerKey(
  pointer: Pick<BlueprintPointer, 'kind' | 'path' | 'name'>,
) {
  return pointer.kind === 'file' || pointer.kind === 'folder'
    ? `${pointer.kind}:${pointer.path}`
    : `${pointer.kind}:${pointer.path}:${pointer.name ?? ''}`
}

function parseBlueprintPointer(value: unknown): BlueprintPointer | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<BlueprintPointer>
  const path = typeof item.path === 'string' ? item.path.trim() : ''
  if (!path) return null
  if (item.kind === 'file' || item.kind === 'folder') {
    return { kind: item.kind, path }
  }
  if (item.kind !== 'function' && item.kind !== 'variable') return null
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  if (!name) return null
  return { kind: item.kind, path, name }
}

export function parseBlueprintPointers(value: unknown): BlueprintPointer[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const pointers: BlueprintPointer[] = []
  for (const item of value) {
    const parsed = parseBlueprintPointer(item)
    if (!parsed) continue
    const key = blueprintPointerKey(parsed)
    if (seen.has(key)) continue
    seen.add(key)
    pointers.push(parsed)
  }
  return pointers
}

export function findBlueprintPointer(
  pointers: BlueprintPointer[],
  kind: BlueprintPointerKind,
  path: string,
  name?: string,
) {
  return pointers.some((item) =>
    kind === 'file' || kind === 'folder'
      ? item.kind === kind && item.path === path
      : item.kind === kind && item.path === path && item.name === name,
  )
}

export function toggleBlueprintPointer(
  pointers: BlueprintPointer[],
  next: {
    kind: BlueprintPointerKind
    path: string
    name?: string
  },
): BlueprintPointer[] {
  const path = next.path.trim()
  if (!path || path.startsWith('draft:')) return pointers
  const key = blueprintPointerKey({ ...next, path })
  const without = pointers.filter((item) => blueprintPointerKey(item) !== key)
  if (without.length !== pointers.length) return without
  if (next.kind === 'file' || next.kind === 'folder') {
    return [...without, { kind: next.kind, path }]
  }
  const name = (next.name ?? '').trim()
  if (!name) return without
  return [...without, { kind: next.kind, path, name }]
}

export function dropBlueprintFilePointers(
  pointers: BlueprintPointer[],
  fileIds: Iterable<string>,
  folderPaths: Iterable<string> = [],
) {
  const files = new Set(fileIds)
  const folders = new Set(folderPaths)
  return pointers.filter((item) =>
    item.kind === 'folder' ? !folders.has(item.path) : !files.has(item.path),
  )
}

export function omitCreatedItems<
  T extends {
    blocks: UserCreatedBlock[]
    islands: UserCreatedIsland[]
    functions: PatchSymbolAddition[]
    variables: PatchSymbolAddition[]
    imports: PatchImportAddition[]
    notes: BlueprintNote[]
    pointers: BlueprintPointer[]
  },
>(
  current: T,
  removedBlockIds: Iterable<string>,
  removedFolderPaths: Iterable<string> = [],
): T {
  const files = new Set(removedBlockIds)
  const folders = new Set(removedFolderPaths)
  return {
    ...current,
    blocks: current.blocks.filter((block) => !files.has(block.id)),
    islands: current.islands.filter(
      (island) => !folders.has(createdIslandKey(island)),
    ),
    functions: current.functions.filter((item) => !files.has(item.file)),
    variables: current.variables.filter((item) => !files.has(item.file)),
    imports: current.imports.filter((item) => !files.has(item.file)),
    notes: dropBlueprintFileNotes(current.notes, files),
    pointers: dropBlueprintFilePointers(current.pointers, files, folders),
  }
}

export function dropBlueprintSymbolPointer(
  pointers: BlueprintPointer[],
  path: string,
  kind: 'function' | 'variable',
  name: string,
) {
  return pointers.filter(
    (item) =>
      !(item.kind === kind && item.path === path && item.name === name),
  )
}

export function remapBlueprintFileId(
  fromId: string,
  toId: string,
  data: {
    functions: PatchSymbolAddition[]
    variables: PatchSymbolAddition[]
    imports: PatchImportAddition[]
    notes: BlueprintNote[]
    pointers: BlueprintPointer[]
  },
) {
  if (!fromId || fromId === toId) return data
  return {
    functions: data.functions.map((item) =>
      item.file === fromId ? { ...item, file: toId } : item,
    ),
    variables: data.variables.map((item) =>
      item.file === fromId ? { ...item, file: toId } : item,
    ),
    imports: data.imports.map((item) => ({
      ...item,
      file: item.file === fromId ? toId : item.file,
      from: item.from === fromId ? toId : item.from,
    })),
    notes: data.notes.map((item) =>
      item.file === fromId ? { ...item, file: toId } : item,
    ),
    pointers: data.pointers.map((item) =>
      item.kind !== 'folder' && item.path === fromId
        ? { ...item, path: toId }
        : item,
    ),
  }
}

export function blueprintImportRawFromFile(file: {
  id: string
  name: string
}): string {
  const trimmed = file.name.trim()
  const dot = trimmed.lastIndexOf('.')
  const base = dot > 0 ? trimmed.slice(0, dot) : trimmed
  return `${base || trimmed} from ${file.id}`
}

export function parseBlueprintImport(
  raw: string,
  file: string,
  knownFileIds: Iterable<string> = [],
): PatchImportAddition | null {
  const trimmed = raw.trim().replaceAll('\\', '/')
  if (!trimmed || !file) return null
  const match = trimmed.match(/^(.+?)\s+from\s+(.+)$/i)
  const name = (match?.[1] ?? trimmed).trim()
  const specifier = (match?.[2] ?? trimmed).trim()
  if (!name || !specifier) return null
  const known = new Set(knownFileIds)
  const from =
    known.has(specifier)
      ? specifier
      : ([...known].find(
          (id) => id === specifier || id.endsWith(`/${specifier}`),
        ) ?? specifier)
  return { name, from, file }
}

export function withBlueprintIntent(
  graph: CodebaseGraph,
  functions: PatchSymbolAddition[] = [],
  variables: PatchSymbolAddition[] = [],
  imports: PatchImportAddition[] = [],
): CodebaseGraph {
  if (functions.length === 0 && variables.length === 0 && imports.length === 0) {
    return graph
  }
  const files = graph.files.map((file) => ({
    ...file,
    symbols: [...file.symbols],
    imports: [...file.imports],
  }))
  const byId = new Map(files.map((file) => [file.id, file]))
  const known = new Set(byId.keys())

  for (const item of functions) {
    const file = byId.get(item.file)
    if (!file) continue
    if (file.symbols.some((symbol) => symbol.kind === 'function' && symbol.name === item.name)) {
      continue
    }
    file.symbols.push({ name: item.name, kind: 'function', intended: true })
  }
  for (const item of variables) {
    const file = byId.get(item.file)
    if (!file) continue
    if (file.symbols.some((symbol) => symbol.kind === 'variable' && symbol.name === item.name)) {
      continue
    }
    file.symbols.push({ name: item.name, kind: 'variable', intended: true })
  }
  for (const item of imports) {
    const file = byId.get(item.file)
    if (!file || !known.has(item.from) || file.imports.includes(item.from)) continue
    file.imports.push(item.from)
  }

  return { ...graph, files }
}

