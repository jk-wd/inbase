import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FILE_EXTENSIONS,
  SOURCE_EXTENSIONS,
  RESOLVE_EXTENSIONS,
  collectImportSpecifiers,
  extractJsSymbols,
} from './js-source.mjs'
import {
  dataDir as defaultDataDir,
  targetName as defaultTargetName,
  targetRoot as defaultTargetRoot,
} from './target-config.mjs'

const defaultOutPath = path.join(defaultDataDir, 'codebase.json')
const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.git',
  '.inbase',
])
const IGNORE_FILES = new Set(['package-lock.json'])

function toPosix(filePath) {
  return filePath.split(path.sep).join('/')
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue
      walk(path.join(dir, entry.name), acc)
      continue
    }
    if (IGNORE_FILES.has(entry.name)) continue
    if (!FILE_EXTENSIONS.has(path.extname(entry.name))) continue
    acc.push(path.join(dir, entry.name))
  }
  return acc
}

function languageOf(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return ext || 'txt'
}

function extractSymbols(source, ext) {
  if (!SOURCE_EXTENSIONS.has(ext)) return []
  return extractJsSymbols(source)
}

function resolveExisting(candidate) {
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate
  }

  for (const ext of RESOLVE_EXTENSIONS) {
    const withExt = candidate + ext
    if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
      return withExt
    }
  }

  const indexDir = candidate
  if (fs.existsSync(indexDir) && fs.statSync(indexDir).isDirectory()) {
    for (const ext of RESOLVE_EXTENSIONS) {
      const indexFile = path.join(indexDir, `index${ext}`)
      if (fs.existsSync(indexFile)) return indexFile
    }
  }

  return null
}

function resolveImport(fromFile, specifier, root) {
  if (!specifier.startsWith('.')) return null
  const fromDir = path.dirname(fromFile)
  const candidate = path.resolve(fromDir, specifier)
  const resolved = resolveExisting(candidate)
  if (!resolved) return null
  const relative = toPosix(path.relative(root, resolved))
  if (relative.startsWith('..')) return null
  return relative
}

function ensureFolder(folders, folderPath, rootName) {
  if (folders.has(folderPath)) return

  const parent =
    folderPath === '.'
      ? null
      : toPosix(path.posix.dirname(folderPath)) === '.'
        ? '.'
        : toPosix(path.posix.dirname(folderPath))

  folders.set(folderPath, {
    path: folderPath,
    name: folderPath === '.' ? rootName : path.posix.basename(folderPath),
    parent,
    files: [],
    children: [],
  })

  if (parent) ensureFolder(folders, parent, rootName)
}

export function scanTarget({
  root = defaultTargetRoot,
  name = path.basename(root),
  dest = defaultOutPath,
} = {}) {
  if (!fs.existsSync(root)) {
    throw new Error(
      `Target not found at ${root}. Set VISUAL_CODER_TARGET to the project you want to map.`,
    )
  }

  const absoluteFiles = walk(root)
  const folders = new Map()
  ensureFolder(folders, '.', name)

  const files = absoluteFiles.map((absolutePath) => {
    const relative = toPosix(path.relative(root, absolutePath))
    const ext = path.extname(relative)
    const source = fs.readFileSync(absolutePath, 'utf8')
    const folder = relative.includes('/') ? relative.split('/').slice(0, -1).join('/') : '.'

    ensureFolder(folders, folder, name)

    return {
      id: relative,
      name: path.posix.basename(relative),
      path: relative,
      folder,
      lines: source.split(/\r?\n/).length,
      language: languageOf(relative),
      symbols: extractSymbols(source, ext),
      imports: collectImportSpecifiers(source)
        .map((specifier) => resolveImport(absolutePath, specifier, root))
        .filter(Boolean),
    }
  })

  const fileIds = new Set(files.map((file) => file.id))
  for (const file of files) {
    file.imports = [...new Set(file.imports.filter((id) => fileIds.has(id)))]
  }

  for (const file of files) {
    folders.get(file.folder).files.push(file.id)
  }

  for (const folder of folders.values()) {
    if (!folder.parent) continue
    const parent = folders.get(folder.parent)
    if (!parent.children.includes(folder.path)) {
      parent.children.push(folder.path)
    }
  }

  for (const folder of folders.values()) {
    folder.files.sort((a, b) => a.localeCompare(b))
    folder.children.sort((a, b) => a.localeCompare(b))
  }

  const graph = {
    root: '.',
    targetName: name,
    files,
    folders: [...folders.values()],
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, `${JSON.stringify(graph, null, 2)}\n`)
  console.log(`Scanned ${files.length} files -> ${path.relative(process.cwd(), dest)}`)
  return graph
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invoked === fileURLToPath(import.meta.url)) {
  scanTarget()
}
