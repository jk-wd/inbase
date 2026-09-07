import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  RESOLVE_EXTENSIONS,
  collectImportSpecifiers,
  extractSymbols,
} from './js-source.mjs'
import {
  collectGitignoreSets,
  extraIgnoreSets,
  isIgnoredByGitignore,
  readGitignoreRules,
  shouldIgnoreRelativePath,
  toPosix,
} from './scan-ignore.mjs'
import {
  dataDir as defaultDataDir,
  targetName as defaultTargetName,
  targetRoot as defaultTargetRoot,
} from './target-config.mjs'
import { loadInbaseConfig } from '../../../bin/inbase-config.mjs'

const defaultOutPath = path.join(defaultDataDir, 'codebase.json')
const BINARY_PROBE_BYTES = 8000

export function isBinaryFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r')
    try {
      const buf = Buffer.alloc(BINARY_PROBE_BYTES)
      const bytes = fs.readSync(fd, buf, 0, buf.length, 0)
      return buf.subarray(0, bytes).includes(0)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return true
  }
}

function resolvesThroughIgnored(absolutePath, root) {
  try {
    const real = fs.realpathSync(absolutePath)
    const realRoot = fs.realpathSync(root)
    if (!(real === realRoot || real.startsWith(realRoot + path.sep))) return true
    return shouldIgnoreRelativePath(path.relative(realRoot, real))
  } catch {
    return true
  }
}

function isInside(filePath, root) {
  const file = path.resolve(filePath)
  const base = path.resolve(root)
  return file === base || file.startsWith(base + path.sep)
}

function dataDirToSkip(root, dest) {
  if (!dest) return null
  const dataRoot = path.dirname(path.resolve(dest))
  const target = path.resolve(root)
  if (dataRoot === target) return null
  const relative = path.relative(target, dataRoot)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return dataRoot
}

function walk(dir, root, ignoreSets, skipRoot = null, acc = []) {
  const localRules = readGitignoreRules(dir)
  const nextSets = localRules.length
    ? [...ignoreSets, { base: dir, rules: localRules }]
    : ignoreSets
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name)
    if (skipRoot && isInside(absolutePath, skipRoot)) continue
    const relative = toPosix(path.relative(root, absolutePath))
    if (
      shouldIgnoreRelativePath(relative) ||
      resolvesThroughIgnored(absolutePath, root) ||
      isIgnoredByGitignore(absolutePath, nextSets)
    ) {
      continue
    }
    let stat = entry
    if (entry.isSymbolicLink()) {
      try {
        stat = fs.statSync(absolutePath)
      } catch {
        continue
      }
    }
    if (stat.isDirectory()) {
      walk(absolutePath, root, nextSets, skipRoot, acc)
      continue
    }
    if (!stat.isFile()) continue
    acc.push(absolutePath)
  }
  return acc
}

function listSourceAbsolutes(root, skipRoot = null, extraPatterns = []) {
  return walk(
    root,
    root,
    [...collectGitignoreSets(root), ...extraIgnoreSets(root, extraPatterns)],
    skipRoot,
  )
}

function resolveScanIgnore(root, explicit) {
  if (Array.isArray(explicit)) return explicit
  return loadInbaseConfig(root).ignore
}

function languageOf(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return ext || 'txt'
}

function isUsableFile(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile()
}

function fileWithStem(dir, stem) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue
    const parsed = path.parse(name)
    if (parsed.name !== stem || !parsed.ext) continue
    const full = path.join(dir, name)
    if (isUsableFile(full)) return full
  }
  return null
}

function resolveExisting(candidate) {
  if (isUsableFile(candidate)) return candidate

  for (const ext of RESOLVE_EXTENSIONS) {
    const withExt = candidate + ext
    if (isUsableFile(withExt)) return withExt
  }

  const sibling = fileWithStem(path.dirname(candidate), path.basename(candidate))
  if (sibling) return sibling

  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    for (const ext of RESOLVE_EXTENSIONS) {
      const indexFile = path.join(candidate, `index${ext}`)
      if (isUsableFile(indexFile)) return indexFile
    }
    const indexFile = fileWithStem(candidate, 'index')
    if (indexFile) return indexFile
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

export function listSourceFiles(root, extraPatterns, skipRoot = null) {
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) return []
  return listSourceAbsolutes(
    root,
    skipRoot,
    resolveScanIgnore(root, extraPatterns),
  ).map((absolutePath) => toPosix(path.relative(root, absolutePath)))
}

export function buildScanGraph({
  root = defaultTargetRoot,
  name = path.basename(root),
  ignore,
  skipRoot = null,
} = {}) {
  if (!fs.existsSync(root)) {
    throw new Error(
      `Target not found at ${root}. Set VISUAL_CODER_TARGET to the project you want to map.`,
    )
  }
  if (!fs.statSync(root).isDirectory()) {
    throw new Error(`Target is not a folder: ${root}`)
  }

  const extraPatterns = resolveScanIgnore(root, ignore)
  const absoluteFiles = listSourceAbsolutes(root, skipRoot, extraPatterns)
  const folders = new Map()
  ensureFolder(folders, '.', name)

  const files = absoluteFiles.map((absolutePath) => {
    const relative = toPosix(path.relative(root, absolutePath))
    const folder = relative.includes('/') ? relative.split('/').slice(0, -1).join('/') : '.'

    ensureFolder(folders, folder, name)

    if (isBinaryFile(absolutePath)) {
      return {
        id: relative,
        name: path.posix.basename(relative),
        path: relative,
        folder,
        lines: 1,
        language: languageOf(relative),
        symbols: [],
        imports: [],
        binary: true,
      }
    }

    const source = fs.readFileSync(absolutePath, 'utf8')
    return {
      id: relative,
      name: path.posix.basename(relative),
      path: relative,
      folder,
      lines: source.split(/\r?\n/).length,
      language: languageOf(relative),
      symbols: extractSymbols(source, relative),
      imports: collectImportSpecifiers(source, relative)
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

  return {
    root: '.',
    targetName: name,
    files,
    folders: [...folders.values()],
  }
}

export function scanTarget({
  root = defaultTargetRoot,
  name = path.basename(root),
  dest = defaultOutPath,
  ignore,
} = {}) {
  const graph = buildScanGraph({
    root,
    name,
    ignore,
    skipRoot: dataDirToSkip(root, dest),
  })

  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, `${JSON.stringify(graph, null, 2)}\n`)
  console.log(`Scanned ${graph.files.length} files -> ${path.relative(process.cwd(), dest)}`)
  return graph
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invoked === fileURLToPath(import.meta.url)) {
  scanTarget()
}
