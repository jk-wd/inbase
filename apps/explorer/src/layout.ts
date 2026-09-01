import { CONFIG, fileHeight } from './theme'
import type { ChangeKind } from './theme'
import type {
  CodebaseGraph,
  FileNode,
  FolderNode,
  PatchImport,
  PlacedBridge,
  PlacedFile,
  PlacedFolder,
  WorldLayout,
} from './types'

function indexGraph(graph: CodebaseGraph) {
  const folders = new Map(graph.folders.map((folder) => [folder.path, folder]))
  const files = new Map(graph.files.map((file) => [file.id, file]))
  return { folders, files }
}

function contentWidth() {
  const fileOffset = CONFIG.aisleWidth / 2 + CONFIG.fileWidth / 2 + 0.7
  const fileOuter = fileOffset + CONFIG.fileWidth / 2
  return (fileOuter + 1.1) * 2
}

function dockPitch() {
  return CONFIG.bridgeWidth + CONFIG.bridgeDockGap
}

function subtreeWidth(
  folder: FolderNode,
  folders: Map<string, FolderNode>,
): number {
  return Math.max(contentWidth(), childrenSpan(folder, folders), docksWidth(folder))
}

function childrenSpan(
  folder: FolderNode,
  folders: Map<string, FolderNode>,
): number {
  if (folder.children.length === 0) return 0

  return folder.children.reduce((total, childPath, index) => {
    const child = folders.get(childPath)
    if (!child) return total
    const gap = index === 0 ? 0 : CONFIG.siblingGap
    return total + gap + subtreeWidth(child, folders)
  }, 0)
}

function docksWidth(folder: FolderNode) {
  if (folder.children.length === 0) return 0
  const edge = CONFIG.bridgeWidth / 2 + 1.4
  return (folder.children.length - 1) * dockPitch() + CONFIG.bridgeWidth + edge * 2
}

function areaDepthForCount(fileCount: number) {
  const rows = Math.max(1, Math.ceil(fileCount / 2))
  return CONFIG.areaPadding * 2 + rows * CONFIG.fileSpacing
}

function areaDepth(folder: FolderNode) {
  return areaDepthForCount(folder.files.length)
}

function placeFolder(
  folder: FolderNode,
  originX: number,
  originZ: number,
  graph: ReturnType<typeof indexGraph>,
  files: Record<string, PlacedFile>,
  folders: Record<string, PlacedFolder>,
  bridges: PlacedBridge[],
) {
  const depth = areaDepth(folder)
  const childSpans = folder.children.map((childPath) => {
    const child = graph.folders.get(childPath)
    return child ? subtreeWidth(child, graph.folders) : 0
  })
  const span = childrenSpan(folder, graph.folders)
  const width = Math.max(contentWidth(), span, docksWidth(folder))

  folders[folder.path] = {
    path: folder.path,
    name: folder.name,
    x: originX,
    z: originZ,
    width,
    depth,
    added: Boolean(folder.userCreated),
    userCreated: Boolean(folder.userCreated),
    colorHex: folder.colorHex,
  }

  folder.files.forEach((fileId, index) => {
    const file = graph.files.get(fileId)
    if (!file) return
    const height = fileHeight(file.lines)
    const side: 1 | -1 = index % 2 === 0 ? -1 : 1
    const row = Math.floor(index / 2)
    const z = originZ + CONFIG.areaPadding + row * CONFIG.fileSpacing
    const x =
      originX + side * (CONFIG.aisleWidth / 2 + CONFIG.fileWidth / 2 + 0.7)

    files[fileId] = {
      id: fileId,
      position: [x, height / 2, z],
      size: [CONFIG.fileWidth, height, CONFIG.fileDepth],
      aisleFace: side === -1 ? 1 : -1,
    }
  })

  if (folder.children.length === 0) return

  let cursorX = originX - span / 2
  const parentExitZ = originZ + depth
  const childStartZ = parentExitZ + CONFIG.bridgeLength

  folder.children.forEach((childPath, index) => {
    const child = graph.folders.get(childPath)
    if (!child) return
    const childSpan = childSpans[index]
    const childX = cursorX + childSpan / 2
    cursorX += childSpan + CONFIG.siblingGap

    bridges.push({
      id: `${folder.path}→${child.path}`,
      label: child.name,
      fromLabel: folder.name,
      points: [
        [childX, parentExitZ - CONFIG.bridgeOverlap],
        [childX, childStartZ + CONFIG.bridgeOverlap],
      ],
    })

    placeFolder(child, childX, childStartZ, graph, files, folders, bridges)
  })
}

export function standInFront(file: PlacedFile): [number, number] {
  return [
    file.position[0] + file.aisleFace * (file.size[0] / 2 + 2.6),
    file.position[2],
  ]
}

export function relationTravelTarget(
  fromId: string,
  toId: string,
  x: number,
  z: number,
  files: Record<string, PlacedFile>,
): string {
  const from = files[fromId]
  const to = files[toId]
  if (!from) return toId
  if (!to) return fromId
  const distFrom = Math.hypot(x - from.position[0], z - from.position[2])
  const distTo = Math.hypot(x - to.position[0], z - to.position[2])
  return distFrom <= distTo ? toId : fromId
}

export function relationPairLabel(fromName: string, toName: string) {
  return `${fromName} <- ${toName}`
}

export function fileDisplayName(id: string, files: FileNode[]) {
  const file = files.find((item) => item.id === id)
  if (file) return file.name
  return id.split('/').pop() ?? id
}

export function filesImporting(files: FileNode[], id: string) {
  return files.filter((file) => file.imports.includes(id))
}

export function folderOfFile(fileId: string) {
  return fileId.includes('/') ? fileId.split('/').slice(0, -1).join('/') : '.'
}

export function folderParent(folderPath: string) {
  if (!folderPath || folderPath === '.') return null
  return folderPath.includes('/') ? folderPath.split('/').slice(0, -1).join('/') : '.'
}

export function changeRelatedFolderPaths(
  graph: CodebaseGraph,
  fileIds: Iterable<string>,
  extraFolders: Iterable<string> = [],
) {
  const root = graph.root || '.'
  const paths = new Set<string>([root])
  const filesById = new Map(graph.files.map((file) => [file.id, file]))

  const addAncestors = (start: string | null | undefined) => {
    let current = start
    while (current) {
      paths.add(current)
      current = folderParent(current)
    }
  }

  for (const id of fileIds) {
    const file = filesById.get(id)
    addAncestors(file?.folder ?? folderOfFile(id))
  }
  for (const folder of extraFolders) addAncestors(folder)
  return paths
}

export function filterGraphToChangePaths(
  graph: CodebaseGraph,
  fileIds: Iterable<string>,
  extraFolders: Iterable<string> = [],
): CodebaseGraph {
  const keepFiles = new Set(fileIds)
  const keepFolders = changeRelatedFolderPaths(graph, fileIds, extraFolders)
  return {
    ...graph,
    files: graph.files.filter((file) => keepFiles.has(file.id)),
    folders: graph.folders
      .filter((folder) => keepFolders.has(folder.path))
      .map((folder) => ({
        ...folder,
        files: folder.files.filter((id) => keepFiles.has(id)),
        children: folder.children.filter((path) => keepFolders.has(path)),
      })),
  }
}

function folderName(folderPath: string, rootName: string) {
  if (!folderPath || folderPath === '.') return rootName
  return folderPath.split('/').pop() ?? folderPath
}

function existingAncestor(
  folderPath: string,
  folders: Record<string, PlacedFolder>,
) {
  let current = folderPath
  while (current && current !== '.') {
    if (folders[current]) return current
    current = current.includes('/')
      ? current.split('/').slice(0, -1).join('/')
      : '.'
  }
  if (folders['.']) return '.'
  return Object.keys(folders)[0] ?? '.'
}

export function collectCreateFolders(
  creates: string[],
  existingFolders: Iterable<string>,
) {
  const known = new Set(existingFolders)
  const created = new Set<string>()
  for (const id of creates) {
    let current = folderOfFile(id)
    while (current && current !== '.') {
      if (!known.has(current)) created.add(current)
      current = folderParent(current) ?? '.'
    }
  }
  return [...created].sort(
    (left, right) =>
      left.split('/').filter(Boolean).length - right.split('/').filter(Boolean).length ||
      left.localeCompare(right),
  )
}

function placeFileOnFolder(
  id: string,
  folder: PlacedFolder,
  index: number,
  lines: number,
): PlacedFile {
  const height = fileHeight(lines)
  const side: 1 | -1 = index % 2 === 0 ? -1 : 1
  const row = Math.floor(index / 2)
  return {
    id,
    position: [
      folder.x + side * (CONFIG.aisleWidth / 2 + CONFIG.fileWidth / 2 + 0.7),
      height / 2,
      folder.z + CONFIG.areaPadding + row * CONFIG.fileSpacing,
    ],
    size: [CONFIG.fileWidth, height, CONFIG.fileDepth],
    aisleFace: side === -1 ? 1 : -1,
  }
}

function ensurePreviewFolder(
  folders: Map<string, FolderNode>,
  folderPath: string,
  rootName: string,
) {
  if (!folderPath || folders.has(folderPath)) return
  const parent = folderParent(folderPath)
  if (parent) ensurePreviewFolder(folders, parent, rootName)
  folders.set(folderPath, {
    path: folderPath,
    name: folderName(folderPath, rootName),
    parent,
    files: [],
    children: [],
  })
  if (parent) {
    const parentFolder = folders.get(parent)
    if (parentFolder && !parentFolder.children.includes(folderPath)) {
      parentFolder.children.push(folderPath)
      parentFolder.children.sort((left, right) => left.localeCompare(right))
    }
  }
}

export function withPreviewGraph(
  graph: CodebaseGraph,
  creates: string[],
  createLines: Record<string, number> = {},
  createFolders: string[] = [],
  imports: PatchImport[] = [],
): CodebaseGraph {
  const files = new Map(
    graph.files.map((file) => [file.id, { ...file, imports: [...file.imports] }]),
  )
  const folders = new Map(
    graph.folders.map((folder) => [
      folder.path,
      { ...folder, files: [...folder.files], children: [...folder.children] },
    ]),
  )

  for (const folderPath of createFolders) {
    ensurePreviewFolder(folders, folderPath, graph.targetName)
  }

  for (const id of creates) {
    const folderPath = folderOfFile(id)
    ensurePreviewFolder(folders, folderPath, graph.targetName)
    if (!files.has(id)) {
      files.set(id, {
        id,
        name: id.split('/').pop() ?? id,
        path: id,
        folder: folderPath,
        lines: createLines[id] ?? 12,
        language: id.split('.').pop()?.toLowerCase() ?? 'txt',
        symbols: [],
        imports: [],
      })
    }
    const folder = folders.get(folderPath)
    if (folder && !folder.files.includes(id)) {
      folder.files.push(id)
      folder.files.sort((left, right) => left.localeCompare(right))
    }
  }

  for (const edge of imports) {
    const file = files.get(edge.from)
    if (!file || file.imports.includes(edge.to)) continue
    file.imports.push(edge.to)
  }

  return {
    ...graph,
    files: [...files.values()],
    folders: [...folders.values()],
  }
}

export function markCreatedFolders(layout: WorldLayout, createFolders: string[]) {
  for (const path of createFolders) {
    const folder = layout.folders[path]
    if (folder) layout.folders[path] = { ...folder, added: true }
  }
  return layout
}

export type PreviewOverlay = {
  files: Record<string, PlacedFile>
  folders: Record<string, PlacedFolder>
  bridges: PlacedBridge[]
}

export function placePreviewCreates(
  graph: CodebaseGraph,
  layout: WorldLayout,
  creates: string[],
  createLines: Record<string, number> = {},
): PreviewOverlay {
  const extraFiles: Record<string, PlacedFile> = {}
  const extraFolders: Record<string, PlacedFolder> = {}
  const extraBridges: PlacedBridge[] = []
  const allFolders = () => ({ ...layout.folders, ...extraFolders })
  const newFolders = collectCreateFolders(creates, Object.keys(layout.folders))
  const filesByFolder = new Map<string, string[]>()

  for (const id of creates) {
    const folderPath = folderOfFile(id)
    const list = filesByFolder.get(folderPath) ?? []
    list.push(id)
    filesByFolder.set(folderPath, list)
  }

  for (const folderPath of newFolders) {
    const parentPath = existingAncestor(folderParent(folderPath) ?? '.', allFolders())
    const parent = allFolders()[parentPath]
    if (!parent) continue

    const fileCount = filesByFolder.get(folderPath)?.length ?? 0
    const width = contentWidth()
    const depth = areaDepthForCount(fileCount)
    const siblings = Object.values(allFolders()).filter(
      (folder) => folderParent(folder.path) === parentPath,
    )
    const x =
      siblings.length === 0
        ? parent.x
        : Math.max(...siblings.map((folder) => folder.x + folder.width / 2)) +
          CONFIG.siblingGap +
          width / 2
    const z = parent.z + parent.depth + CONFIG.bridgeLength

    extraFolders[folderPath] = {
      path: folderPath,
      name: folderName(folderPath, graph.targetName),
      x,
      z,
      width,
      depth,
      added: true,
    }
    extraBridges.push({
      id: `${parentPath}→${folderPath}`,
      label: folderName(folderPath, graph.targetName),
      fromLabel: parent.name,
      points: [
        [x, parent.z + parent.depth - CONFIG.bridgeOverlap],
        [x, z + CONFIG.bridgeOverlap],
      ],
    })
  }

  const used = new Map(
    graph.folders.map((folder) => [folder.path, folder.files.length]),
  )
  for (const path of Object.keys(extraFolders)) used.set(path, 0)

  for (const id of creates) {
    if (layout.files[id] || extraFiles[id]) continue
    const folderPath = folderOfFile(id)
    const folders = allFolders()
    const folder = folders[folderPath] ?? folders[existingAncestor(folderPath, folders)]
    if (!folder) continue
    const index = used.get(folder.path) ?? 0
    used.set(folder.path, index + 1)
    extraFiles[id] = placeFileOnFolder(id, folder, index, createLines[id] ?? 12)
  }

  return { files: extraFiles, folders: extraFolders, bridges: extraBridges }
}

export function withPreviewLayout(
  layout: WorldLayout,
  overlay: PreviewOverlay,
): WorldLayout {
  return {
    ...layout,
    files: { ...layout.files, ...overlay.files },
    folders: { ...layout.folders, ...overlay.folders },
    bridges: [...layout.bridges, ...overlay.bridges],
  }
}

export function layoutWorld(graph: CodebaseGraph): WorldLayout {
  const indexed = indexGraph(graph)
  const root = indexed.folders.get(graph.root)
  if (!root) {
    throw new Error('Codebase graph is missing the root folder')
  }

  const files: Record<string, PlacedFile> = {}
  const folders: Record<string, PlacedFolder> = {}
  const bridges: PlacedBridge[] = []

  placeFolder(root, 0, 0, indexed, files, folders, bridges)

  const rootFolder = folders[root.path]
  return {
    files,
    folders,
    bridges,
    spawn: [rootFolder.x, CONFIG.eyeHeight, rootFolder.z + 2.4],
  }
}

export function folderAt(
  x: number,
  z: number,
  layout: Pick<WorldLayout, 'folders'>,
): PlacedFolder | null {
  let current: PlacedFolder | null = null
  for (const folder of Object.values(layout.folders)) {
    const insideX = Math.abs(x - folder.x) <= folder.width / 2
    const insideZ = z >= folder.z && z <= folder.z + folder.depth
    if (insideX && insideZ) current = folder
  }
  return current
}

export function mapPointOntoFolder(
  x: number,
  z: number,
  fromLayout: Pick<WorldLayout, 'folders'>,
  toLayout: Pick<WorldLayout, 'folders'>,
  fallback: [number, number] | null = null,
): [number, number] | null {
  const folder = folderAt(x, z, fromLayout)
  if (!folder) return fallback
  const next = toLayout.folders[folder.path]
  if (!next) return fallback
  const relX = folder.width ? (x - folder.x) / folder.width : 0
  const relZ = folder.depth ? (z - folder.z) / folder.depth : 0
  return [
    next.x + Math.min(Math.max(relX, -0.45), 0.45) * next.width,
    next.z + Math.min(Math.max(relZ, 0), 1) * next.depth,
  ]
}

function distanceToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
) {
  const dx = bx - ax
  const dz = bz - az
  const lengthSq = dx * dx + dz * dz
  if (lengthSq === 0) return Math.hypot(px - ax, pz - az)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq))
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
}

export function locationLabel(x: number, z: number, layout: WorldLayout) {
  const folder = folderAt(x, z, layout)
  if (folder) return folder.name

  for (const bridge of layout.bridges) {
    for (let i = 1; i < bridge.points.length; i += 1) {
      const from = bridge.points[i - 1]
      const to = bridge.points[i]
      const distance = distanceToSegment(x, z, from[0], from[1], to[0], to[1])
      if (distance <= CONFIG.bridgeWidth / 2 + 0.5) {
        return `bridge to ${bridge.label}`
      }
    }
  }

  return 'open ground'
}

export function worldBounds(layout: WorldLayout) {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  for (const folder of Object.values(layout.folders)) {
    minX = Math.min(minX, folder.x - folder.width / 2)
    maxX = Math.max(maxX, folder.x + folder.width / 2)
    minZ = Math.min(minZ, folder.z)
    maxZ = Math.max(maxZ, folder.z + folder.depth)
  }

  if (!Number.isFinite(minX)) {
    return { minX: -20, maxX: 20, minZ: -20, maxZ: 20, cx: 0, cz: 0, width: 40, depth: 40 }
  }

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    width: maxX - minX,
    depth: maxZ - minZ,
  }
}

export function regionBounds(
  layout: WorldLayout,
  fileIds: Iterable<string> = [],
  folderPaths: Iterable<string> = [],
) {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let found = false

  const include = (left: number, right: number, top: number, bottom: number) => {
    found = true
    minX = Math.min(minX, left)
    maxX = Math.max(maxX, right)
    minZ = Math.min(minZ, top)
    maxZ = Math.max(maxZ, bottom)
  }

  for (const path of folderPaths) {
    const folder = layout.folders[path]
    if (!folder) continue
    include(
      folder.x - folder.width / 2,
      folder.x + folder.width / 2,
      folder.z,
      folder.z + folder.depth,
    )
  }

  for (const id of fileIds) {
    const file = layout.files[id]
    if (!file) continue
    include(
      file.position[0] - file.size[0] / 2,
      file.position[0] + file.size[0] / 2,
      file.position[2] - file.size[2] / 2,
      file.position[2] + file.size[2] / 2,
    )
  }

  if (!found) return worldBounds(layout)

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    width: Math.max(maxX - minX, 8),
    depth: Math.max(maxZ - minZ, 8),
  }
}

export function fileChangeKind(
  id: string,
  planned: Set<string>,
  created: Set<string>,
  deleted: Set<string>,
): ChangeKind | null {
  if (deleted.has(id)) return 'remove'
  if (created.has(id)) return 'add'
  if (planned.has(id)) return 'edit'
  return null
}

/** Blueprint islands are planned structure, not git-added paths. */
export function isBlueprintFolder(folder: PlacedFolder | undefined) {
  if (!folder) return false
  return Boolean(folder.userCreated || (folder.overlay && folder.added))
}

export function folderChangeHighlights(
  planned: Set<string>,
  created: Set<string>,
  deleted: Set<string>,
  folders: Record<string, PlacedFolder>,
): Partial<Record<string, ChangeKind>> {
  const highlighted: Partial<Record<string, ChangeKind>> = {}
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
    if (kinds.size !== 1) continue
    const kind = [...kinds][0]
    if (kind === 'add' && isBlueprintFolder(folders[folder])) continue
    highlighted[folder] = kind
  }
  if (planned.size > 0 || deleted.size > 0) {
    for (const folder of Object.values(folders)) {
      if (!folder.added || isBlueprintFolder(folder)) continue
      const kinds = folderKinds.get(folder.path)
      if (!kinds || kinds.size === 1) {
        highlighted[folder.path] ??= 'add'
      }
    }
  }
  return highlighted
}
