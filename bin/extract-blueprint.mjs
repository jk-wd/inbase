import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { explorerRoot } from './project.mjs'
import { toPosix } from '../apps/explorer/scripts/scan-ignore.mjs'

const SESSION_COLORS = [
  { id: 'coral', name: 'Coral', hex: '#f87171' },
  { id: 'amber', name: 'Amber', hex: '#fbbf24' },
  { id: 'lime', name: 'Lime', hex: '#a3e635' },
  { id: 'orange', name: 'Orange', hex: '#fb923c' },
  { id: 'violet', name: 'Violet', hex: '#c084fc' },
  { id: 'teal', name: 'Teal', hex: '#2dd4bf' },
  { id: 'crimson', name: 'Crimson', hex: '#dc2626' },
  { id: 'forest', name: 'Forest', hex: '#15803d' },
  { id: 'grey', name: 'Grey', hex: '#4b5563' },
  { id: 'white', name: 'White', hex: '#f4f4f5' },
]

export const EXTRACT_INSTRUCTION = `Extract a valuable Inbase blueprint, not a dump of the tree.

A blueprint is the spatial plan another LLM will follow: folders, files, functions, vars, imports, and notes. Keep only what explains the architecture.

Keep:
- The folder skeleton that defines how the area is organized (not every nested helper folder)
- Entry points, public APIs, core domain modules, and files that are unique to this area
- Exported functions and classes that are the real API, plus a few pivotal internals
- Important constants, shared state, and config vars
- Imports that show a real coupling between kept files
- Notes that say why a file or symbol exists, the contract, or a non-obvious invariant

Drop:
- Generated files, lockfiles, dist/build/coverage, snapshots, and editor/tooling noise
- Tests unless they are the contract for this area
- Trivial re-export barrels unless they ARE the public API
- Every helper, getter, loop var, and one-off local
- Notes that only restate the file or symbol name
- Pointers unless something is a landmark the next chat must keep in view

Prefer fewer, better items. Paths are relative to the scanned folder. After curating, write the layer with --write — do not copy the inventory as-is.`

function explorerHref(relative) {
  return pathToFileURL(path.join(explorerRoot, relative)).href
}

export function resolveExtractOutputPath(targetRoot, outputArg) {
  const raw = typeof outputArg === 'string' ? outputArg.trim() : ''
  if (!raw) return null
  const resolved = path.isAbsolute(raw)
    ? path.normalize(raw)
    : path.resolve(targetRoot, raw)
  return resolved.toLowerCase().endsWith('.json') ? resolved : `${resolved}.json`
}

async function loadBlueprintFiles() {
  return import(explorerHref('scripts/blueprint-files.mjs'))
}

function usage() {
  console.error(
    'Usage: inbase extract-blueprint <folder> <output-file> [--write [layer.json|-]]',
  )
  process.exit(1)
}

export function resolveUserPath(value, cwd = process.cwd()) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(cwd, raw)
}

function fileRole(relative) {
  const posix = toPosix(relative)
  if (/\.(test|spec)\.[^/]+$/i.test(posix)) return 'test'
  if (/(^|\/)(__tests__|__mocks__|fixtures|snapshots)(\/|$)/i.test(posix)) {
    return 'test'
  }
  if (/(^|\/)(dist|build|coverage|\.next)(\/|$)/i.test(posix)) return 'generated'
  if (/(^|\/)package-lock\.json$/i.test(posix)) return 'lockfile'
  return 'source'
}

export function compactInventory(graph, folderPath) {
  const files = (graph.files ?? []).flatMap((file) => {
    if (file.binary) return []
    const functions = []
    const classes = []
    const variables = []
    for (const symbol of file.symbols ?? []) {
      if (symbol.kind === 'variable') variables.push(symbol.name)
      else if (symbol.kind === 'class') classes.push(symbol.name)
      else functions.push(symbol.name)
    }
    return [
      {
        path: file.path,
        folder: file.folder,
        name: file.name,
        lines: file.lines,
        language: file.language,
        role: fileRole(file.path),
        functions,
        classes,
        variables,
        imports: file.imports ?? [],
      },
    ]
  })
  const folders = (graph.folders ?? [])
    .filter((folder) => folder.path && folder.path !== '.')
    .map((folder) => ({
      path: folder.path,
      parent: folder.parent ?? '.',
      name: folder.name,
      fileCount: folder.files?.length ?? 0,
    }))
  return {
    folder: toPosix(folderPath),
    name: graph.targetName,
    folders,
    files,
  }
}

function posixPath(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  return toPosix(raw).replace(/^\.\//, '').replace(/\/+$/, '')
}

export function fileEntryFromPath(filePath) {
  const resolved = posixPath(filePath)
  if (!resolved || resolved === '.') return null
  const name = path.posix.basename(resolved)
  const folder = resolved.includes('/')
    ? path.posix.dirname(resolved)
    : '.'
  return {
    id: resolved,
    name,
    path: resolved,
    folder,
  }
}

export function folderEntryFromPath(folderPath, parent) {
  const resolved = posixPath(folderPath)
  if (!resolved || resolved === '.') return null
  const inferredParent =
    resolved.includes('/') ? path.posix.dirname(resolved) : '.'
  return {
    id: resolved,
    name: path.posix.basename(resolved),
    path: resolved,
    parent: posixPath(parent) || inferredParent || '.',
  }
}

function ensureFolderChain(folders, folderPath) {
  let current = posixPath(folderPath)
  while (current && current !== '.') {
    if (!folders.has(current)) {
      const entry = folderEntryFromPath(current)
      if (!entry) break
      folders.set(current, entry)
    }
    current = folders.get(current).parent
  }
}

function normalizeSymbol(item) {
  if (!item || typeof item !== 'object') return null
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  const file = posixPath(item.file)
  if (!name || !file) return null
  return { name, file }
}

function normalizeImport(item) {
  if (!item || typeof item !== 'object') return null
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  const from = typeof item.from === 'string' ? item.from.trim() : ''
  const file = posixPath(item.file)
  if (!name || !from || !file) return null
  return { name, from, file }
}

function normalizeNote(item) {
  if (!item || typeof item !== 'object') return null
  const file = posixPath(item.file)
  const note = typeof item.note === 'string' ? item.note.trim() : ''
  const kind = item.kind
  if (!file || !note) return null
  if (kind === 'file') return { file, kind: 'file', note }
  if (kind !== 'function' && kind !== 'variable') return null
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  if (!name) return null
  return { file, kind, name, note }
}

function normalizePointer(item) {
  if (!item || typeof item !== 'object') return null
  const kind = item.kind
  const pointerPath = posixPath(item.path)
  if (!pointerPath) return null
  if (kind !== 'file' && kind !== 'folder' && kind !== 'function' && kind !== 'variable') {
    return null
  }
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  if (kind === 'file' || kind === 'folder') return { kind, path: pointerPath }
  if (!name) return null
  return { kind, path: pointerPath, name }
}

export function normalizeExtractLayer(layer = {}) {
  const files = []
  const seenFiles = new Set()
  for (const item of Array.isArray(layer.files) ? layer.files : []) {
    const pathValue =
      typeof item === 'string' ? item : item?.path || item?.id || ''
    const entry = fileEntryFromPath(pathValue)
    if (!entry || seenFiles.has(entry.path)) continue
    if (item && typeof item === 'object' && typeof item.name === 'string' && item.name.trim()) {
      entry.name = item.name.trim()
    }
    if (item && typeof item === 'object' && typeof item.folder === 'string' && item.folder.trim()) {
      entry.folder = posixPath(item.folder) || entry.folder
    }
    seenFiles.add(entry.path)
    files.push(entry)
  }

  const folders = new Map()
  for (const item of Array.isArray(layer.folders) ? layer.folders : []) {
    const pathValue =
      typeof item === 'string' ? item : item?.path || item?.id || ''
    const entry = folderEntryFromPath(pathValue, item?.parent)
    if (!entry || folders.has(entry.path)) continue
    folders.set(entry.path, entry)
  }
  for (const file of files) {
    ensureFolderChain(folders, file.folder)
  }
  for (const folder of [...folders.values()]) {
    ensureFolderChain(folders, folder.parent)
  }

  const addedFunctions = (Array.isArray(layer.addedFunctions) ? layer.addedFunctions : [])
    .map(normalizeSymbol)
    .filter(Boolean)
  const addedVariables = (Array.isArray(layer.addedVariables) ? layer.addedVariables : [])
    .map(normalizeSymbol)
    .filter(Boolean)
  const addedImports = (Array.isArray(layer.addedImports) ? layer.addedImports : [])
    .map(normalizeImport)
    .filter(Boolean)
  const notes = (Array.isArray(layer.notes) ? layer.notes : [])
    .map(normalizeNote)
    .filter(Boolean)
  const pointers = (Array.isArray(layer.pointers) ? layer.pointers : [])
    .map(normalizePointer)
    .filter(Boolean)

  return {
    hidden: false,
    files,
    folders: [...folders.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    addedFunctions,
    addedVariables,
    addedImports,
    notes,
    pointers,
  }
}

function emptyLocals() {
  return SESSION_COLORS.map((color) => ({
    color: color.id,
    colorName: color.name,
    colorHex: color.hex,
    hidden: false,
    files: [],
    folders: [],
    addedFunctions: [],
    addedVariables: [],
    addedImports: [],
    notes: [],
    pointers: [],
  }))
}

export function blueprintNameFromOutput(outputPath, folderPath) {
  const base = path.basename(outputPath, path.extname(outputPath)).trim()
  if (base) return base
  return path.basename(folderPath) || 'Blueprint'
}

export async function writeExtractedBlueprint({
  targetRoot,
  outputPath,
  name,
  layer,
}) {
  const { saveBlueprintDocument } = await loadBlueprintFiles()
  const global = normalizeExtractLayer(layer)
  return saveBlueprintDocument(targetRoot, {
    name,
    filePath: outputPath,
    global,
    locals: emptyLocals(),
  })
}

function parseWriteArgs(args) {
  const writeIndex = args.indexOf('--write')
  if (writeIndex < 0) {
    return { write: false, layerPath: null, rest: args }
  }
  const next = args[writeIndex + 1]
  const takesPath = Boolean(next) && !next.startsWith('-')
  const rest = args.filter((_, index) => {
    if (index === writeIndex) return false
    if (takesPath && index === writeIndex + 1) return false
    return true
  })
  return {
    write: true,
    layerPath: takesPath ? next : '-',
    rest,
  }
}

function readLayerJson(layerPath) {
  const raw =
    !layerPath || layerPath === '-'
      ? fs.readFileSync(0, 'utf8')
      : fs.readFileSync(layerPath, 'utf8')
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('Could not parse curated blueprint layer JSON')
  }
}

function printInventory(inventory, folderPath, outputPath) {
  console.log(`VISUAL_CODER_EXTRACT_FOLDER ${folderPath}`)
  console.log(`VISUAL_CODER_EXTRACT_OUTPUT ${outputPath}`)
  console.log('VISUAL_CODER_EXTRACT_INVENTORY_START')
  console.log(JSON.stringify(inventory, null, 2))
  console.log('VISUAL_CODER_EXTRACT_INVENTORY_END')
  console.log('VISUAL_CODER_EXTRACT_INSTRUCTION_START')
  console.log(EXTRACT_INSTRUCTION)
  console.log('VISUAL_CODER_EXTRACT_INSTRUCTION_END')
  console.log(
    'VISUAL_CODER_EXTRACT Curate the inventory (do not copy everything). Then run:',
  )
  console.log(
    'npx inbase extract-blueprint <folder> <output-file> --write',
  )
  console.log('and pass the curated layer JSON on stdin (or --write layer.json).')
}

export async function extractBlueprint(args = [], host = {}) {
  const parsed = parseWriteArgs(args)
  const [folderArg, outputArg] = parsed.rest
  if (!folderArg || !outputArg) usage()

  const cwd = host.cwd ?? process.cwd()
  const targetRoot = host.targetRoot ?? cwd
  const folderPath = resolveUserPath(folderArg, cwd)
  const outputPath = resolveExtractOutputPath(targetRoot, outputArg)
  if (!outputPath) usage()

  if (!folderPath || !fs.existsSync(folderPath)) {
    console.error(`Folder not found: ${folderArg}`)
    process.exit(1)
  }
  if (!fs.statSync(folderPath).isDirectory()) {
    console.error(`Not a folder: ${folderArg}`)
    process.exit(1)
  }

  if (parsed.write) {
    const layer = readLayerJson(parsed.layerPath)
    const saved = await writeExtractedBlueprint({
      targetRoot,
      outputPath,
      name: blueprintNameFromOutput(outputPath, folderPath),
      layer,
    })
    const written = normalizeExtractLayer(layer)
    console.log(`VISUAL_CODER_EXTRACT_SAVED ${saved.path}`)
    console.log(
      `Wrote blueprint ${saved.name} (${saved.relativePath}) with ${written.files.length} files, ${written.folders.length} folders, ${written.addedFunctions.length} functions, ${written.addedVariables.length} vars, ${written.notes.length} notes.`,
    )
    return saved
  }

  const { buildScanGraph } = await import(
    explorerHref('scripts/scan-target.mjs')
  )
  const graph = buildScanGraph({
    root: folderPath,
    name: path.basename(folderPath),
    ignore: host.config?.ignore,
  })
  const inventory = compactInventory(graph, folderPath)
  printInventory(inventory, folderPath, outputPath)
  return inventory
}
