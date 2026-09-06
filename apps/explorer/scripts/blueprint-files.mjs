import fs from 'node:fs'
import path from 'node:path'
import { toPosix } from './scan-ignore.mjs'
import {
  emptyBlueprint,
  listLocalBlueprints,
  readBlueprint,
  SESSION_COLORS,
  writeBlueprint,
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

function layerFields(value) {
  return {
    hidden: Boolean(value?.hidden),
    files: layerList(value, 'files', 'userCreatedBlocks', blueprintFileEntry),
    folders: layerList(value, 'folders', 'userCreatedIslands', blueprintFolderEntry),
    addedFunctions: Array.isArray(value?.addedFunctions) ? value.addedFunctions : [],
    addedVariables: Array.isArray(value?.addedVariables) ? value.addedVariables : [],
    addedImports: Array.isArray(value?.addedImports) ? value.addedImports : [],
    notes: Array.isArray(value?.notes) ? value.notes : [],
    pointers: Array.isArray(value?.pointers) ? value.pointers : [],
  }
}

function localLayer(value) {
  const color = typeof value?.color === 'string' ? value.color.trim() : ''
  if (!color || color === 'global') return null
  return {
    color,
    colorName: typeof value?.colorName === 'string' ? value.colorName : color,
    colorHex: typeof value?.colorHex === 'string' ? value.colorHex : '',
    ...layerFields(value),
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
    global: layerFields(input.global),
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

export function applyBlueprintDocument(dataDir, document) {
  const parsed = parseBlueprintDocument(document)
  writeBlueprint(dataDir, {
    ...emptyBlueprint(),
    ...parsed.global,
  })
  const byColor = new Map(parsed.locals.map((local) => [local.color, local]))
  for (const color of SESSION_COLORS) {
    const local = byColor.get(color.id)
    writeBlueprintByColor(dataDir, color.id, {
      ...emptyBlueprint(),
      ...(local ?? {}),
    })
  }
  return {
    name: parsed.name,
    global: readBlueprint(dataDir),
    localBlueprints: listLocalBlueprints(dataDir),
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
  const applied = applyBlueprintDocument(dataDir, loaded.document)
  return {
    ...applied,
    name: loaded.name,
    fileName: loaded.fileName,
    savedAt: loaded.savedAt ?? loaded.document.savedAt,
    path: loaded.path,
    relativePath: loaded.relativePath,
  }
}
