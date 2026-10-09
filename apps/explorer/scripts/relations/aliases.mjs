import fs from 'node:fs'
import path from 'node:path'
import { shouldIgnoreRelativePath, toPosix } from '../scan-ignore.mjs'

const CONFIG_NAME = /^(?:tsconfig(?:\..+)?|jsconfig)\.json$/

function parseJsonc(text) {
  let out = ''
  let quote = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (quote) {
      out += char
      if (char === '\\') {
        out += next ?? ''
        index += 1
        continue
      }
      if (char === '"') quote = false
      continue
    }
    if (char === '"') {
      quote = true
      out += char
      continue
    }
    if (char === '/' && next === '/') {
      index += 1
      while (index + 1 < text.length && text[index + 1] !== '\n') index += 1
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
        index += 1
      }
      index += 1
      continue
    }
    out += char
  }
  return JSON.parse(out.replace(/,\s*([}\]])/g, '$1'))
}

function projectRelative(root, absolute) {
  const relative = toPosix(path.relative(root, absolute))
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null
  return relative
}

function normalizeRelative(id) {
  const parts = []
  for (const part of id.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

function resolveExtends(fromDir, spec) {
  if (typeof spec !== 'string' || !spec) return null
  if (spec.startsWith('.')) {
    const direct = path.resolve(fromDir, spec)
    if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct
    if (fs.existsSync(`${direct}.json`)) return `${direct}.json`
    return null
  }
  return null
}

function resolveSameDirReference(filePath, spec) {
  if (typeof spec !== 'string' || !spec) return null
  const fromDir = path.dirname(filePath)
  let resolved = path.resolve(fromDir, spec)
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    const nested = path.join(resolved, 'tsconfig.json')
    if (!fs.existsSync(nested)) return null
    resolved = nested
  } else if (!resolved.endsWith('.json') && fs.existsSync(`${resolved}.json`)) {
    resolved = `${resolved}.json`
  }
  if (path.dirname(resolved) !== fromDir) return null
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null
  return resolved
}

function readConfig(filePath, seen) {
  let real = filePath
  try {
    real = fs.realpathSync(filePath)
  } catch {
    return null
  }
  if (seen.has(real)) return null
  seen.add(real)
  let json
  try {
    json = parseJsonc(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
  if (!json || typeof json !== 'object') return null

  let baseDir = null
  let paths = null
  const extendsList =
    json.extends == null ? [] : Array.isArray(json.extends) ? json.extends : [json.extends]
  for (const item of extendsList) {
    const parentPath = resolveExtends(path.dirname(filePath), item)
    if (!parentPath) continue
    const parent = readConfig(parentPath, seen)
    if (!parent) continue
    if (parent.baseDir) baseDir = parent.baseDir
    if (parent.paths) paths = parent.paths
  }

  const options = json.compilerOptions
  if (options && typeof options === 'object') {
    if (typeof options.baseUrl === 'string') {
      baseDir = path.resolve(path.dirname(filePath), options.baseUrl)
    }
    if (options.paths && typeof options.paths === 'object') paths = options.paths
  }

  if (!paths && Array.isArray(json.references)) {
    for (const ref of json.references) {
      const refFile = resolveSameDirReference(filePath, ref?.path)
      if (!refFile) continue
      const referenced = readConfig(refFile, seen)
      if (!referenced?.paths) continue
      paths = referenced.paths
      baseDir = referenced.baseDir
      break
    }
  }

  return { paths, baseDir }
}

function mapTarget(baseDir, root, target) {
  const star = target.indexOf('*')
  if (star === -1) {
    const relative = projectRelative(root, path.resolve(baseDir, target))
    if (relative == null) return null
    return { exact: true, path: relative }
  }
  const relativeHead = projectRelative(root, path.resolve(baseDir, target.slice(0, star)))
  if (relativeHead == null) return null
  return {
    exact: false,
    prefix: relativeHead ? `${relativeHead}/` : '',
    suffix: toPosix(target.slice(star + 1)),
  }
}

function rulesFromPaths(paths, baseDir, root) {
  const rules = []
  for (const [pattern, targets] of Object.entries(paths)) {
    if (typeof pattern !== 'string' || !Array.isArray(targets)) continue
    const star = pattern.indexOf('*')
    const exact = star === -1
    const mapped = []
    for (const target of targets) {
      if (typeof target !== 'string' || !target) continue
      const ruleTarget = mapTarget(baseDir, root, target)
      if (ruleTarget) mapped.push(ruleTarget)
    }
    if (mapped.length === 0) continue
    rules.push({
      pattern,
      exact,
      specPrefix: exact ? pattern : pattern.slice(0, star),
      specSuffix: exact ? '' : pattern.slice(star + 1),
      targets: mapped,
    })
  }
  return rules
}

function configRank(fileName) {
  if (fileName === 'tsconfig.app.json') return 3
  if (fileName === 'tsconfig.json') return 2
  if (fileName === 'jsconfig.json') return 0
  return 1
}

function listConfigFiles(root) {
  const found = []
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name)
      const relative = toPosix(path.relative(root, absolute))
      if (shouldIgnoreRelativePath(relative)) continue
      if (entry.isDirectory()) {
        walk(absolute)
        continue
      }
      if (entry.isFile() && CONFIG_NAME.test(entry.name)) found.push(absolute)
    }
  }
  walk(root)
  return found
}

/** Path mappings from tsconfig/jsconfig files, nearest directory first at lookup. */
export function loadImportAliases(root) {
  if (!root || !fs.existsSync(root)) return []
  const byDir = new Map()
  for (const filePath of listConfigFiles(root)) {
    const config = readConfig(filePath, new Set())
    if (!config?.paths) continue
    const baseDir = config.baseDir ?? path.dirname(filePath)
    const rules = rulesFromPaths(config.paths, baseDir, root)
    if (rules.length === 0) continue
    const dir = toPosix(path.relative(root, path.dirname(filePath))) || '.'
    const rank = configRank(path.basename(filePath))
    const scope = byDir.get(dir) ?? { dir, rules: new Map() }
    for (const rule of rules) {
      const previous = scope.rules.get(rule.pattern)
      if (previous && previous.rank > rank) continue
      scope.rules.set(rule.pattern, { rule, rank })
    }
    byDir.set(dir, scope)
  }
  return [...byDir.values()].map((scope) => ({
    dir: scope.dir,
    rules: [...scope.rules.values()].map((entry) => entry.rule),
  }))
}

function folderOfFileId(fileId) {
  const index = fileId.lastIndexOf('/')
  return index === -1 ? '.' : fileId.slice(0, index)
}

function ancestorScope(fromFileId, scopes) {
  const fromDir = folderOfFileId(fromFileId)
  let best = null
  let bestLen = -1
  for (const scope of scopes) {
    const dir = scope.dir
    const matches = dir === '.' || fromDir === dir || fromDir.startsWith(`${dir}/`)
    if (!matches) continue
    const len = dir === '.' ? 0 : dir.length
    if (len < bestLen) continue
    best = scope
    bestLen = len
  }
  return best
}

function captureOf(rule, specifier) {
  if (rule.exact) return rule.pattern === specifier ? '' : null
  if (!specifier.startsWith(rule.specPrefix)) return null
  if (rule.specSuffix && !specifier.endsWith(rule.specSuffix)) return null
  const end = specifier.length - rule.specSuffix.length
  if (end < rule.specPrefix.length) return null
  const capture = specifier.slice(rule.specPrefix.length, end)
  if (capture.split('/').includes('..')) return null
  return capture
}

function mappedCandidates(specifier, scope) {
  if (!scope) return []
  let best = null
  let bestLen = -1
  for (const rule of scope.rules) {
    const capture = captureOf(rule, specifier)
    if (capture == null) continue
    const len = rule.exact ? rule.pattern.length : rule.specPrefix.length
    if (len < bestLen) continue
    if (len === bestLen && best) continue
    best = { rule, capture }
    bestLen = len
  }
  if (!best) return []
  const candidates = []
  for (const target of best.rule.targets) {
    const raw = target.exact
      ? target.path
      : `${target.prefix}${best.capture}${target.suffix}`
    const normalized = normalizeRelative(raw)
    if (normalized) candidates.push(normalized)
  }
  return candidates
}

function atAliasCandidates(specifier, fromFileId) {
  if (!specifier.startsWith('@/')) return []
  const rest = specifier.slice(2)
  if (!rest || rest.split('/').includes('..')) return []
  const dirs = fromFileId.split('/').slice(0, -1)
  for (let index = dirs.length - 1; index >= 0; index -= 1) {
    if (dirs[index] !== 'src') continue
    const prefix = dirs.slice(0, index + 1).join('/')
    const candidate = normalizeRelative(`${prefix}/${rest}`)
    return candidate ? [candidate] : []
  }
  const candidate = normalizeRelative(`src/${rest}`)
  return candidate ? [candidate] : []
}

export function specifierCandidates(specifier, fromFileId, scopes = []) {
  if (!specifier || specifier.startsWith('.')) return []
  const mapped = mappedCandidates(specifier, ancestorScope(fromFileId, scopes))
  if (!specifier.startsWith('@/')) return mapped
  const seen = new Set(mapped)
  const candidates = [...mapped]
  for (const candidate of atAliasCandidates(specifier, fromFileId)) {
    if (seen.has(candidate)) continue
    seen.add(candidate)
    candidates.push(candidate)
  }
  return candidates
}
