import fs from 'node:fs'
import path from 'node:path'
import { toPosix } from './scan-ignore.mjs'
import {
  emptyBlueprint,
  findSessionIdByColor,
  namedBlueprintDependsOn,
  namedBlueprintSteps,
  resolveSessionColor,
  SESSION_COLORS,
  writeBlueprintByColor,
} from './session-store.mjs'

export const BLUEPRINTS_DIR_NAME = 'blueprints'
export const BLUEPRINT_KIND = 'blueprint'
const LEGACY_BLUEPRINT_KIND = 'inbase-blueprint'

function isBlueprintKind(kind) {
  return kind === BLUEPRINT_KIND || kind === LEGACY_BLUEPRINT_KIND
}
export const BLUEPRINT_VERSION = 1
export const WRAPPER_KIND = 'inbase-wrapper'
export const WRAPPER_VERSION = 1
export const BLUEPRINT_FILE_SUFFIX = '.blueprint.json'
export const WRAPPER_FILE_SUFFIX = '-wrapper.json'

export function defaultBlueprintsDir(targetRoot) {
  return path.join(path.resolve(targetRoot), BLUEPRINTS_DIR_NAME)
}

export function blueprintSubjectSlug(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const slug = raw
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
  return slug || 'blueprint'
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function nextNumberedBlueprintSet(targetRoot, subject) {
  const slug = blueprintSubjectSlug(subject)
  const directory = defaultBlueprintsDir(targetRoot)
  const pattern = new RegExp(`^${escapeRegExp(slug)}-(\\d+)(?:\\.json)?$`, 'i')
  let max = 0
  if (fs.existsSync(directory)) {
    for (const entry of fs.readdirSync(directory)) {
      const match = pattern.exec(entry)
      if (!match) continue
      const num = Number(match[1])
      if (Number.isInteger(num) && num > max) max = num
    }
  }
  const number = max + 1
  const name = `${slug}-${number}`
  return {
    subject: slug,
    number,
    name,
    folderPath: `${BLUEPRINTS_DIR_NAME}/${name}`,
  }
}

function stripBlueprintSuffix(value) {
  return value
    .replace(/-wrapper\.json$/i, '')
    .replace(/\.blueprint\.json$/i, '')
    .replace(/\.json$/i, '')
}

export function blueprintSetName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) throw new Error('Blueprint name is required')
  const safe = stripBlueprintSuffix(path.basename(trimmed))
    .replace(/[\\/]/g, '-')
    .replace(/[?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  if (!safe) throw new Error('Blueprint name is required')
  return safe
}

export function wrapperFileName(setName) {
  return `${setName}${WRAPPER_FILE_SUFFIX}`
}

export function blueprintFileNameFor(setName, color, single) {
  return single
    ? `${setName}${BLUEPRINT_FILE_SUFFIX}`
    : `${setName}-${color}${BLUEPRINT_FILE_SUFFIX}`
}

function resolveAgainst(targetRoot, value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(targetRoot, value)
}

function folderFromPath(filePath) {
  const base = path.basename(filePath)
  if (/-wrapper\.json$/i.test(base) || /\.blueprint\.json$/i.test(base)) {
    return path.dirname(filePath)
  }
  return path.join(path.dirname(filePath), stripBlueprintSuffix(base))
}

export function resolveBlueprintSetFolder(targetRoot, input = {}) {
  const target = path.resolve(targetRoot)
  const folder = typeof input.folder === 'string' ? input.folder.trim() : ''
  if (folder) return resolveAgainst(target, folder)
  const filePath = typeof input.filePath === 'string' ? input.filePath.trim() : ''
  if (filePath) return folderFromPath(resolveAgainst(target, filePath))
  const directory = typeof input.directory === 'string' ? input.directory.trim() : ''
  const parent = directory ? resolveAgainst(target, directory) : defaultBlueprintsDir(target)
  return path.join(parent, blueprintSetName(input.name))
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

const CONTENT_KEYS = [
  'files',
  'folders',
  'functions',
  'classes',
  'variables',
  'imports',
  'notes',
  'pointers',
  'deleted',
  'steps',
]

function arrayField(value, key, legacyKey) {
  if (Array.isArray(value?.[key])) return value[key]
  if (Array.isArray(value?.[legacyKey])) return value[legacyKey]
  return []
}

function blueprintContent(value) {
  return {
    files: layerList(value, 'files', 'userCreatedBlocks', blueprintFileEntry),
    folders: layerList(value, 'folders', 'userCreatedIslands', blueprintFolderEntry),
    functions: arrayField(value, 'functions', 'addedFunctions'),
    classes: arrayField(value, 'classes'),
    variables: arrayField(value, 'variables', 'addedVariables'),
    imports: arrayField(value, 'imports', 'addedImports'),
    notes: blueprintNotes(value?.notes),
    pointers: Array.isArray(value?.pointers) ? value.pointers : [],
    deleted: Array.isArray(value?.deleted)
      ? [...new Set(value.deleted.filter((item) => typeof item === 'string' && item.trim()))]
      : [],
    steps: namedBlueprintSteps(value?.steps),
  }
}

function colorLayer(value) {
  const color = resolveSessionColor(typeof value?.color === 'string' ? value.color.trim() : '')
  if (!color) return null
  return {
    color: color.id,
    colorName: color.name,
    colorHex: color.hex,
    hidden: Boolean(value?.hidden),
    ...blueprintContent(value),
    dependsOn: namedBlueprintDependsOn(color.id, value?.dependsOn),
  }
}

function hasContent(layer) {
  return (
    CONTENT_KEYS.some((key) => layer[key].length > 0) || layer.dependsOn.length > 0
  )
}

function setLayers(input) {
  const raw = Array.isArray(input.blueprints)
    ? input.blueprints
    : Array.isArray(input.locals)
      ? input.locals
      : []
  const seen = new Set()
  const layers = []
  for (const item of raw) {
    const layer = colorLayer(item)
    if (!layer || seen.has(layer.color)) continue
    seen.add(layer.color)
    layers.push(layer)
  }
  const defaultColor = SESSION_COLORS[0]
  if (input.global != null && defaultColor && !seen.has(defaultColor.id)) {
    layers.unshift(colorLayer({ ...input.global, color: defaultColor.id }))
  }
  const order = SESSION_COLORS.map((color) => color.id)
  return layers
    .filter(hasContent)
    .sort((left, right) => order.indexOf(left.color) - order.indexOf(right.color))
}

/**
 * In-memory blueprint set: the set name plus one layer per session color.
 * On disk this becomes a wrapper and one `.blueprint.json` per layer.
 */
export function normalizeBlueprintSet(input = {}) {
  const name =
    typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'Blueprint'
  return {
    name,
    savedAt:
      typeof input.savedAt === 'string' && input.savedAt
        ? input.savedAt
        : new Date().toISOString(),
    blueprints: setLayers(input),
  }
}

export function serializeBlueprintFile(name, layer) {
  return {
    version: BLUEPRINT_VERSION,
    kind: BLUEPRINT_KIND,
    name,
    ...blueprintContent(layer),
  }
}

export function serializeBlueprintSet(input = {}) {
  const set = normalizeBlueprintSet(input)
  const setName = blueprintSetName(set.name)
  const single = set.blueprints.length === 1
  const files = set.blueprints.map((layer) => {
    const fileName = blueprintFileNameFor(setName, layer.color, single)
    return {
      color: layer.color,
      fileName,
      document: serializeBlueprintFile(stripBlueprintSuffix(fileName), layer),
    }
  })
  return {
    name: set.name,
    savedAt: set.savedAt,
    wrapperFileName: wrapperFileName(setName),
    wrapper: {
      version: WRAPPER_VERSION,
      kind: WRAPPER_KIND,
      name: set.name,
      savedAt: set.savedAt,
      blueprints: set.blueprints.map((layer, index) => ({
        color: layer.color,
        file: files[index].fileName,
        hidden: layer.hidden,
        dependsOn: layer.dependsOn,
      })),
    },
    files,
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isWrapper(value) {
  return isObject(value) && value.kind === WRAPPER_KIND
}

function isLegacyDocument(value) {
  return (
    isObject(value) &&
    (Array.isArray(value.blueprints) || Array.isArray(value.locals) || value.global != null)
  )
}

export function parseBlueprintFile(value) {
  if (!isObject(value) || isWrapper(value) || isLegacyDocument(value)) {
    throw new Error('Not a blueprint file')
  }
  if (value.kind != null && !isBlueprintKind(value.kind)) {
    throw new Error('Not a blueprint file')
  }
  if (value.version != null && value.version !== BLUEPRINT_VERSION) {
    throw new Error(`Unsupported blueprint version ${value.version}`)
  }
  const hasLayer = [...CONTENT_KEYS, 'userCreatedBlocks', 'userCreatedIslands'].some(
    (key) => value[key] != null,
  )
  if (value.kind == null && !hasLayer) {
    throw new Error('Not a blueprint file')
  }
  return {
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : null,
    ...blueprintContent(value),
  }
}

export function parseWrapper(value) {
  if (!isWrapper(value)) throw new Error('Not a blueprint wrapper')
  if (value.version != null && value.version !== WRAPPER_VERSION) {
    throw new Error(`Unsupported wrapper version ${value.version}`)
  }
  const entries = []
  for (const item of Array.isArray(value.blueprints) ? value.blueprints : []) {
    const color = resolveSessionColor(typeof item?.color === 'string' ? item.color : '')
    const file = typeof item?.file === 'string' ? item.file.trim() : ''
    if (!color || !file) continue
    entries.push({
      color: color.id,
      file,
      hidden: Boolean(item.hidden),
      dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn : [],
    })
  }
  return {
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'Blueprint',
    savedAt: typeof value.savedAt === 'string' ? value.savedAt : '',
    blueprints: entries,
  }
}

function parseLegacyDocument(value) {
  if (value.kind != null && !isBlueprintKind(value.kind)) {
    throw new Error('Not a blueprint file')
  }
  if (value.version != null && value.version !== 1) {
    throw new Error(`Unsupported blueprint version ${value.version}`)
  }
  return normalizeBlueprintSet({
    name: value.name,
    savedAt: value.savedAt,
    blueprints: value.blueprints ?? value.locals,
    global: value.global,
  })
}

/** Builds a set from a wrapper; `readFile(name)` returns the parsed JSON of a referenced file. */
export function parseBlueprintSet(wrapperValue, readFile) {
  const wrapper = parseWrapper(wrapperValue)
  return normalizeBlueprintSet({
    name: wrapper.name,
    savedAt: wrapper.savedAt || undefined,
    blueprints: wrapper.blueprints.map((entry) => {
      const document = readFile(entry.file)
      if (document == null) {
        throw new Error(`Blueprint file not found: ${entry.file}`)
      }
      return {
        ...parseBlueprintFile(document),
        color: entry.color,
        hidden: entry.hidden,
        dependsOn: entry.dependsOn,
      }
    }),
  })
}

function singleBlueprintSet(value, fallbackName) {
  const parsed = parseBlueprintFile(value)
  return normalizeBlueprintSet({
    name: parsed.name ?? fallbackName,
    blueprints: [{ ...parsed, color: SESSION_COLORS[0].id }],
  })
}

/**
 * Parses one JSON value: a `.blueprint.json` (loaded into the first color) or an
 * older single-file document with session colors inside. A wrapper alone is
 * rejected because its blueprint files are not available.
 */
export function parseBlueprintDocument(value) {
  if (!isObject(value)) throw new Error('Not a blueprint file')
  if (isWrapper(value)) {
    throw new Error(
      'This is a wrapper file. Choose it together with its .blueprint.json files.',
    )
  }
  if (isLegacyDocument(value)) return parseLegacyDocument(value)
  return singleBlueprintSet(value, 'Blueprint')
}

/** Parses several uploaded files at once: a wrapper with its blueprint files, or loose blueprint files. */
export function parseBlueprintDocuments(documents) {
  const items = (Array.isArray(documents) ? documents : []).filter(
    (item) => item && isObject(item.document),
  )
  if (items.length === 0) throw new Error('Not a blueprint file')
  const wrapper = items.find((item) => isWrapper(item.document))
  if (wrapper) {
    const byName = new Map(
      items.map((item) => [path.basename(String(item.fileName ?? '')), item.document]),
    )
    return parseBlueprintSet(wrapper.document, (file) => byName.get(path.basename(file)))
  }
  if (items.length === 1) return parseBlueprintDocument(items[0].document)
  const layers = items.map((item, index) => {
    const color = SESSION_COLORS[index]
    if (!color) throw new Error(`At most ${SESSION_COLORS.length} blueprint files at once`)
    return { ...parseBlueprintFile(item.document), color: color.id }
  })
  return normalizeBlueprintSet({
    name: stripBlueprintSuffix(path.basename(String(items[0].fileName ?? 'Blueprint'))),
    blueprints: layers,
  })
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    throw new Error(`Could not read blueprint file ${path.basename(filePath)}`)
  }
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory()
  } catch {
    return false
  }
}

function findWrapperIn(folder) {
  const preferred = path.join(folder, wrapperFileName(path.basename(folder)))
  if (isFile(preferred)) return preferred
  const match = fs
    .readdirSync(folder)
    .filter((entry) => entry.toLowerCase().endsWith(WRAPPER_FILE_SUFFIX))
    .sort()[0]
  return match ? path.join(folder, match) : null
}

function readWrapperSet(wrapperPath) {
  const folder = path.dirname(wrapperPath)
  return parseBlueprintSet(readJsonFile(wrapperPath), (file) => {
    const resolved = path.resolve(folder, file)
    const relative = path.relative(folder, resolved)
    if (relative.startsWith('..') || path.isAbsolute(relative) || !isFile(resolved)) {
      return null
    }
    return readJsonFile(resolved)
  })
}

/** Reads a wrapper, a set folder, a single `.blueprint.json`, or an older single-file document. */
export function readBlueprintSetFromPath(filePath) {
  const resolved = path.resolve(filePath)
  if (isDirectory(resolved)) {
    const wrapperPath = findWrapperIn(resolved)
    if (!wrapperPath) throw new Error('No wrapper file in that blueprint folder')
    return { set: readWrapperSet(wrapperPath), path: wrapperPath }
  }
  if (!isFile(resolved)) throw new Error('Blueprint file not found')
  const value = readJsonFile(resolved)
  if (isWrapper(value)) return { set: readWrapperSet(resolved), path: resolved }
  if (isLegacyDocument(value)) return { set: parseLegacyDocument(value), path: resolved }
  return {
    set: singleBlueprintSet(value, stripBlueprintSuffix(path.basename(resolved))),
    path: resolved,
  }
}

export function listSavedBlueprints(targetRoot) {
  const directory = defaultBlueprintsDir(targetRoot)
  if (!fs.existsSync(directory)) {
    return { directory, items: [] }
  }
  const items = []
  for (const entry of fs.readdirSync(directory)) {
    const entryPath = path.join(directory, entry)
    let candidate = null
    if (isDirectory(entryPath)) {
      candidate = findWrapperIn(entryPath)
    } else if (entry.toLowerCase().endsWith('.json') && isFile(entryPath)) {
      candidate = entryPath
    }
    if (!candidate) continue
    let read
    try {
      read = readBlueprintSetFromPath(candidate)
    } catch {
      continue
    }
    items.push({
      name: read.set.name,
      fileName: path.basename(read.path),
      savedAt: read.set.savedAt,
      ...describePath(targetRoot, read.path),
    })
  }
  items.sort((left, right) => right.savedAt.localeCompare(left.savedAt))
  return { directory, items }
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(temporary, filePath)
}

function previousBlueprintFiles(folder) {
  const wrapperPath = isDirectory(folder) ? findWrapperIn(folder) : null
  if (!wrapperPath) return { wrapperPath: null, files: [] }
  try {
    const wrapper = parseWrapper(readJsonFile(wrapperPath))
    return { wrapperPath, files: wrapper.blueprints.map((entry) => entry.file) }
  } catch {
    return { wrapperPath, files: [] }
  }
}

/**
 * Writes a blueprint set folder: `<name>-wrapper.json` plus one
 * `<name>.blueprint.json` (or `<name>-<color>.blueprint.json` when there are
 * several). Blueprint files the previous wrapper listed but this save no
 * longer needs are removed.
 */
export function saveBlueprintDocument(targetRoot, input = {}) {
  const folder = resolveBlueprintSetFolder(targetRoot, input)
  const serialized = serializeBlueprintSet({
    ...input,
    name: input.name ?? path.basename(folder),
  })
  const previous = previousBlueprintFiles(folder)
  fs.mkdirSync(folder, { recursive: true })
  for (const file of serialized.files) {
    writeJsonAtomic(path.join(folder, file.fileName), file.document)
  }
  const wrapperPath = path.join(folder, serialized.wrapperFileName)
  writeJsonAtomic(wrapperPath, serialized.wrapper)

  const kept = new Set(serialized.files.map((file) => file.fileName))
  for (const file of previous.files) {
    const stale = path.resolve(folder, file)
    if (
      kept.has(path.basename(stale)) ||
      path.dirname(stale) !== folder ||
      !stale.toLowerCase().endsWith(BLUEPRINT_FILE_SUFFIX)
    ) {
      continue
    }
    fs.rmSync(stale, { force: true })
  }
  if (previous.wrapperPath && path.resolve(previous.wrapperPath) !== wrapperPath) {
    fs.rmSync(previous.wrapperPath, { force: true })
  }

  return {
    name: serialized.name,
    fileName: serialized.wrapperFileName,
    savedAt: serialized.savedAt,
    ...describePath(targetRoot, wrapperPath),
    folder: describePath(targetRoot, folder).relativePath,
    blueprintFiles: serialized.files.map((file) => ({
      color: file.color,
      ...describePath(targetRoot, path.join(folder, file.fileName)),
    })),
  }
}

export function readBlueprintDocument(targetRoot, input = {}) {
  const target = path.resolve(targetRoot)
  let filePath
  if (input.filePath) {
    filePath = resolveAgainst(target, String(input.filePath).trim())
  } else {
    const setName = blueprintSetName(input.name)
    const folder = path.join(defaultBlueprintsDir(target), setName)
    const legacy = path.join(defaultBlueprintsDir(target), `${setName}.json`)
    filePath = isDirectory(folder) ? folder : legacy
  }
  if (!fs.existsSync(filePath)) {
    throw new Error('Blueprint file not found')
  }
  const read = readBlueprintSetFromPath(filePath)
  return {
    document: read.set,
    name: read.set.name,
    fileName: path.basename(read.path),
    savedAt: read.set.savedAt,
    ...describePath(target, read.path),
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
  const byColor = new Map(parsed.blueprints.map((local) => [local.color, local]))
  const defaultColor = SESSION_COLORS[0]
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
  let loaded
  if (Array.isArray(input.documents) && input.documents.length > 0) {
    const set = parseBlueprintDocuments(input.documents)
    loaded = {
      document: set,
      name: set.name,
      fileName: null,
      savedAt: null,
      path: null,
      relativePath: null,
    }
  } else if (input.document != null) {
    const set = parseBlueprintDocument(input.document)
    loaded = {
      document: set,
      name: set.name,
      fileName: null,
      savedAt: null,
      path: typeof input.filePath === 'string' ? input.filePath : null,
      relativePath: typeof input.filePath === 'string' ? input.filePath : null,
    }
  } else {
    loaded = readBlueprintDocument(targetRoot, input)
  }
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
