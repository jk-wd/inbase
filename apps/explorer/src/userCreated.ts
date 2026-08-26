import { CONFIG, fileHeight } from './theme'
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
  PlacedFolder,
  UserCreatedBlock,
  UserCreatedIsland,
  WorldLayout,
} from './types'

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

function islandKey(island: UserCreatedIsland) {
  return island.path || island.id
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

function expandParentsToChildren(
  folders: Record<string, PlacedFolder>,
  islands: UserCreatedIsland[],
) {
  const parentPaths = new Set<string>()
  for (const island of islands) {
    let current: string | null = island.parent
    while (current) {
      parentPaths.add(current)
      current = folderParent(current)
    }
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
    let extent = parent.width / 2
    for (const child of children) {
      extent = Math.max(
        extent,
        Math.abs(child.x - child.width / 2 - parent.x),
        Math.abs(child.x + child.width / 2 - parent.x),
      )
    }
    const width = extent * 2
    if (width > parent.width) folders[parentPath] = { ...parent, width }
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
      folders[id] = { ...folders[id], added: true, name: island.name || folders[id].name }
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

