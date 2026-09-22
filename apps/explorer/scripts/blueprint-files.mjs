import fs from 'node:fs'
import path from 'node:path'
import { toPosix } from './scan-ignore.mjs'
import {
  emptyBlueprint,
  findSessionIdByColor,
  namedBlueprintDependsOn,
  SESSION_COLORS,
  writeBlueprintByColor,
} from './session-store.mjs'

export const BLUEPRINTS_DIR_NAME = 'blueprints'
export const BLUEPRINT_DOCUMENT_KIND = 'inbase-blueprint'
export const BLUEPRINT_DOCUMENT_VERSION = 1

export function defaultBlueprintsDir(targetRoot) {
  return path.join(path.resolve(targetRoot), BLUEPRINTS_DIR_NAME)
}

export function blueprintFileName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) throw new Error('Blueprint name is required')
  const base = path.basename(trimmed).replace(/\.json$/i, '')
  const safe = base
    .replace(/[\\/]/g, '-')
    .replace(/[?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  if (!safe) throw new Error('Blueprint name is required')
  return `${safe}.json`
}

function withJsonExtension(filePath) {
  return filePath.toLowerCase().endsWith('.json') ? filePath : `${filePath}.json`
}

export function resolveBlueprintSavePath(targetRoot, input = {}) {
  const target = path.resolve(targetRoot)
  const filePath = typeof input.filePath === 'string' ? input.filePath.trim() : ''
  if (filePath) return withJsonExtension(resolveAgainst(target, filePath))
  const fileName = blueprintFileName(input.name)
  const directory = typeof input.directory === 'string' ? input.directory.trim() : ''
  const dir = directory
    ? resolveAgainst(target, directory)
    : defaultBlueprintsDir(target)
  return path.join(dir, fileName)
}

function resolveAgainst(targetRoot, value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(targetRoot, value)
}

function describePath(targetRoot, filePath) {
  const resolved = path.resolve(filePath)
  const relative = path.relative(path.resolve(targetRoot), resolved)
  const inside =
    relative === '' ||
    (relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  return {
    path: resolved,
    relativePath: inside ? toPosix(relative) : resolved,
  }
}

function blueprintFileEntry(value) {
  if (!value || typeof value !== 'object') return null
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.path !== 'string' ||
    typeof value.folder !== 'string'
  ) {
    return null
  }
  return {
    id: value.id,
    name: value.name,
    path: value.path,
    folder: value.folder,
  }
}

function blueprintFolderEntry(value) {
  if (!value || typeof value !== 'object') return null
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.path !== 'string' ||
    typeof value.parent !== 'string'
  ) {
    return null
  }
  return {
    id: value.id,
    name: value.name,
    path: value.path,
    parent: value.parent,
  }
}

function layerList(value, key, legacyKey, mapEntry) {
  const raw = Array.isArray(value?.[key])
    ? value[key]
    : Array.isArray(value?.[legacyKey])
      ? value[legacyKey]
      : []
  return raw.map(mapEntry).filter(Boolean)
}

function blueprintNoteEntry(value) {
  if (!value || typeof value !== 'object') return null
  const file = typeof value.file === 'string' ? value.file.trim() : ''
  const note = typeof value.note === 'string' ? value.note : ''
  if (!file || !note.trim()) return null
  if (value.kind == null || value.kind === 'file') {
    return { file, kind: 'file', note }
  }
  if (value.kind === 'folder') {
    return { file, kind: 'folder', note }
  }
  if (
    (value.kind === 'function' || value.kind === 'variable') &&
    typeof value.name === 'string' &&
    value.name.trim() !== ''
  ) {
    return { file, kind: value.kind, name: value.name.trim(), note }
  }
  return null
}

function blueprintNotes(value) {
  const raw = Array.isArray(value) ? value : []
  const seen = new Set()
  const notes = []
  for (const item of raw) {
    const stored = blueprintNoteEntry(item)
    if (!stored) continue
    const key =
      stored.kind === 'file' || stored.kind === 'folder'
        ? `${stored.kind}:${stored.file}`
        : `${stored.kind}:${stored.file}:${stored.name}`
    if (seen.has(key)) continue
    seen.add(key)
    notes.push(stored)
  }
  return notes
}

function layerFileIds(files) {
  const ids = new Set()
  for (const file of Array.isArray(files) ? files : []) {
    if (typeof file?.id === 'string' && file.id) ids.add(file.id)
    if (typeof file?.path === 'string' && file.path) ids.add(file.path)
  }
  return ids
}

function codebaseFileIds(dataDir) {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'codebase.json'), 'utf8'),
    )
    return Array.isArray(parsed?.files)
      ? parsed.files
          .map((file) => file?.id)
          .filter((id) => typeof id === 'string' && id)
      : []
  } catch {
    return []
  }
}

function existsInTarget(targetRoot, relativePath, directory) {
  if (!targetRoot || typeof relativePath !== 'string' || !relativePath.trim()) {
    return false
  }
  const root = path.resolve(targetRoot)
  const resolved = path.resolve(root, relativePath)
  const relative = path.relative(root, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false
  if (!relative && !directory) return false
  try {
    const stat = fs.statSync(resolved)
    return directory ? stat.isDirectory() : stat.isFile()
  } catch {
    return false
  }
}

function layerFolderPaths(folders) {
  const paths = new Set()
  for (const folder of Array.isArray(folders) ? folders : []) {
    if (typeof folder?.path === 'string' && folder.path) paths.add(folder.path)
    if (typeof folder?.id === 'string' && folder.id) paths.add(folder.id)
  }
  return paths
}

function applicableNotes(notes, files, folders, existingFileIds, targetRoot) {
  const knownFiles = new Set(existingFileIds)
  for (const id of layerFileIds(files)) knownFiles.add(id)
  const knownFolders = layerFolderPaths(folders)
  return notes.filter((note) =>
    note.kind === 'folder'
      ? knownFolders.has(note.file) || existsInTarget(targetRoot, note.file, true)
      : knownFiles.has(note.file) || existsInTarget(targetRoot, note.file, false),
  )
}

function withApplicableNotes(layer, existingFileIds, targetRoot) {
  return {
    ...layer,
    notes: applicableNotes(
      layer.notes,
      layer.files,
      layer.folders,
      existingFileIds,
      targetRoot,
    ),
  }
}

function layerFields(value, colorId = null) {
  return {
    hidden: Boolean(value?.hidden),
    files: layerList(value, 'files', 'userCreatedBlocks', blueprintFileEntry),
    folders: layerList(value, 'folders', 'userCreatedIslands', blueprintFolderEntry),
    addedFunctions: Array.isArray(value?.addedFunctions) ? value.addedFunctions : [],
    addedVariables: Array.isArray(value?.addedVariables) ? value.addedVariables : [],
    addedImports: Array.isArray(value?.addedImports) ? value.addedImports : [],
    notes: blueprintNotes(value?.notes),
    pointers: Array.isArray(value?.pointers) ? value.pointers : [],
    dependsOn: namedBlueprintDependsOn(colorId ?? value?.color, value?.dependsOn),
  }
}

function localLayer(value) {
  const color = typeof value?.color === 'string' ? value.color.trim() : ''
  if (!color || color === 'global') return null
  return {
    color,
    colorName: typeof value?.colorName === 'string' ? value.colorName : color,
    colorHex: typeof value?.colorHex === 'string' ? value.colorHex : '',
    ...layerFields(value, color),
  }
}

export function serializeBlueprintDocument(input = {}) {
  const name =
    typeof input.name === 'string' && input.name.trim()
      ? input.name.trim()
      : 'Blueprint'
  const locals = Array.isArray(input.locals)
    ? input.locals.map(localLayer).filter(Boolean)
    : []
  return {
    version: BLUEPRINT_DOCUMENT_VERSION,
    kind: BLUEPRINT_DOCUMENT_KIND,
    name,
    savedAt:
      typeof input.savedAt === 'string' && input.savedAt
        ? input.savedAt
        : new Date().toISOString(),
    global: layerFields(input.global, SESSION_COLORS[0]?.id),
    locals,
  }
}

export function parseBlueprintDocument(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('Not a blueprint file')
  }
  if (value.kind != null && value.kind !== BLUEPRINT_DOCUMENT_KIND) {
    throw new Error('Not a blueprint file')
  }
  if (
    value.version != null &&
    value.version !== BLUEPRINT_DOCUMENT_VERSION
  ) {
    throw new Error(`Unsupported blueprint version ${value.version}`)
  }
  const document = serializeBlueprintDocument({
    name: value.name,
    savedAt: value.savedAt,
    global: value.global ?? value,
    locals: value.locals,
  })
  if (
    value.kind == null &&
    value.global == null &&
    value.files == null &&
    value.folders == null &&
    value.userCreatedBlocks == null &&
    value.userCreatedIslands == null
  ) {
    throw new Error('Not a blueprint file')
  }
  return document
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    throw new Error('Could not read blueprint file')
  }
}

export function listSavedBlueprints(targetRoot) {
  const directory = defaultBlueprintsDir(targetRoot)
  if (!fs.existsSync(directory)) {
    return { directory, items: [] }
  }
  const items = []
  for (const fileName of fs.readdirSync(directory)) {
    if (!fileName.toLowerCase().endsWith('.json')) continue
    const filePath = path.join(directory, fileName)
    let stat
    try {
      stat = fs.statSync(filePath)
    } catch {
      continue
    }
    if (!stat.isFile()) continue
    let parsed = null
    try {
      parsed = parseBlueprintDocument(JSON.parse(fs.readFileSync(filePath, 'utf8')))
    } catch {
      continue
    }
    const described = describePath(targetRoot, filePath)
    items.push({
      name: parsed.name,
      fileName,
      savedAt: parsed.savedAt,
      ...described,
    })
  }
  items.sort((left, right) => right.savedAt.localeCompare(left.savedAt))
  return { directory, items }
}

export function saveBlueprintDocument(targetRoot, input = {}) {
  const document = serializeBlueprintDocument(input)
  const filePath = resolveBlueprintSavePath(targetRoot, {
    name: input.name ?? document.name,
    directory: input.directory,
    filePath: input.filePath,
  })
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`)
  fs.renameSync(temporary, filePath)
  const described = describePath(targetRoot, filePath)
  return {
    name: document.name,
    fileName: path.basename(filePath),
    savedAt: document.savedAt,
    ...described,
  }
}

export function readBlueprintDocument(targetRoot, input = {}) {
  const filePath = input.filePath
    ? resolveAgainst(path.resolve(targetRoot), String(input.filePath).trim())
    : path.join(
        defaultBlueprintsDir(targetRoot),
        blueprintFileName(input.name),
      )
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error('Blueprint file not found')
  }
  const document = parseBlueprintDocument(readJsonFile(filePath))
  const described = describePath(targetRoot, filePath)
  return {
    document,
    name: document.name,
    fileName: path.basename(filePath),
    savedAt: document.savedAt,
    ...described,
  }
}

export function applyBlueprintDocument(dataDir, document, options = {}) {
  const parsed = parseBlueprintDocument(document)
  const targetRoot =
    typeof options.targetRoot === 'string' ? options.targetRoot : null
  const existingFileIds = [
    ...codebaseFileIds(dataDir),
    ...(Array.isArray(options.existingFileIds) ? options.existingFileIds : []),
  ]
  const byColor = new Map(parsed.locals.map((local) => [local.color, local]))
  const defaultColor = SESSION_COLORS[0]
  if (defaultColor && !byColor.has(defaultColor.id)) {
    byColor.set(defaultColor.id, parsed.global)
  }
  const localBlueprints = []
  for (const color of SESSION_COLORS) {
    const local = byColor.get(color.id)
    const written = writeBlueprintByColor(
      dataDir,
      color.id,
      withApplicableNotes(
        { ...emptyBlueprint(), ...(local ?? {}) },
        existingFileIds,
        targetRoot,
      ),
    )
    const sessionId = findSessionIdByColor(dataDir, color.id)
    if (!sessionId) continue
    localBlueprints.push({
      color: color.id,
      colorName: color.name,
      colorHex: color.hex,
      sessionId,
      ...written,
    })
  }
  const global =
    localBlueprints.find((item) => item.color === defaultColor?.id) ??
    emptyBlueprint()
  return {
    name: parsed.name,
    global,
    localBlueprints,
  }
}

export function loadBlueprintDocument(targetRoot, dataDir, input = {}) {
  const loaded =
    input.document != null
      ? {
          document: parseBlueprintDocument(input.document),
          name:
            typeof input.document?.name === 'string'
              ? input.document.name
              : 'Blueprint',
          fileName: null,
          savedAt: null,
          path: typeof input.filePath === 'string' ? input.filePath : null,
          relativePath:
            typeof input.filePath === 'string' ? input.filePath : null,
        }
      : readBlueprintDocument(targetRoot, input)
  const applied = applyBlueprintDocument(dataDir, loaded.document, {
    targetRoot,
  })
  return {
    ...applied,
    name: loaded.name,
    fileName: loaded.fileName,
    savedAt: loaded.savedAt ?? loaded.document.savedAt,
    path: loaded.path,
    relativePath: loaded.relativePath,
  }
}
