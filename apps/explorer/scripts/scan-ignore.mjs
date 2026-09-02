import fs from 'node:fs'
import path from 'node:path'

export const IGNORE_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.git',
  '.inbase',
])

export const IGNORE_FILE_NAMES = new Set(['package-lock.json'])

export function toPosix(filePath) {
  return filePath.split(path.sep).join('/')
}

function isViteDepCache(parts) {
  const viteAt = parts.indexOf('vite')
  if (viteAt < 0) return false
  return parts
    .slice(viteAt + 1)
    .some((part) => part === 'deps' || part.startsWith('deps_temp'))
}

/** True when any path segment is ignored, e.g. apps/web/node_modules/pkg/index.js. */
export function shouldIgnoreRelativePath(relative) {
  const parts = toPosix(relative).split('/').filter(Boolean)
  if (isViteDepCache(parts)) return true
  if (
    parts.some(
      (part) =>
        IGNORE_DIR_NAMES.has(part) ||
        (part.startsWith('.') && part !== '.' && part !== '..'),
    )
  ) {
    return true
  }
  return IGNORE_FILE_NAMES.has(parts.at(-1) ?? '')
}

export function parseGitignore(text) {
  const rules = []
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    let pattern = trimmed
    const negated = pattern.startsWith('!')
    if (negated) pattern = pattern.slice(1)
    const dirOnly = pattern.endsWith('/')
    if (dirOnly) pattern = pattern.slice(0, -1)
    const fromRoot = pattern.startsWith('/')
    if (fromRoot) pattern = pattern.slice(1)
    const anchored = fromRoot || pattern.includes('/')
    rules.push({ negated, dirOnly, anchored, pattern })
  }
  return rules
}

function globToRegExp(pattern) {
  let source = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*' && pattern[index + 1] === '*') {
      source += '.*'
      index += 1
      if (pattern[index + 1] === '/') index += 1
      continue
    }
    if (char === '*') {
      source += '[^/]*'
      continue
    }
    if (char === '?') {
      source += '[^/]'
      continue
    }
    if ('\\.^$+{}()|[]'.includes(char)) source += `\\${char}`
    else source += char
  }
  source += '(/.*)?$'
  return new RegExp(source)
}

function ruleMatches(relative, rule) {
  if (!rule.pattern) return false
  if (rule.anchored || rule.pattern.includes('*') || rule.pattern.includes('?')) {
    const source = rule.anchored ? rule.pattern : `**/${rule.pattern}`
    return globToRegExp(source).test(relative) || globToRegExp(rule.pattern).test(relative)
  }
  const parts = relative.split('/').filter(Boolean)
  if (rule.dirOnly) {
    return parts.slice(0, -1).includes(rule.pattern) || relative === rule.pattern
  }
  return parts.includes(rule.pattern)
}

export function matchesGitignoreRules(relative, rules) {
  const rel = toPosix(relative).replace(/^\/+/, '')
  if (!rel) return false
  let ignored = false
  for (const rule of rules) {
    if (ruleMatches(rel, rule)) ignored = !rule.negated
  }
  return ignored
}

export function readGitignoreRules(dir) {
  try {
    return parseGitignore(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'))
  } catch {
    return []
  }
}

export function extraIgnoreSets(root, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return []
  const rules = parseGitignore(patterns.filter(Boolean).join('\n'))
  if (!rules.length) return []
  return [{ base: path.resolve(root), rules }]
}

export function collectGitignoreSets(root) {
  const resolved = path.resolve(root)
  if (isIgnoredByEnclosingGitignore(resolved)) {
    const rules = readGitignoreRules(resolved)
    return rules.length ? [{ base: resolved, rules }] : []
  }
  const chain = [resolved]
  let dir = resolved
  while (!fs.existsSync(path.join(dir, '.git'))) {
    const parent = path.dirname(dir)
    if (parent === dir) {
      const rules = readGitignoreRules(resolved)
      return rules.length ? [{ base: resolved, rules }] : []
    }
    dir = parent
    chain.push(dir)
  }
  const sets = []
  for (const base of chain.reverse()) {
    const rules = readGitignoreRules(base)
    if (rules.length) sets.push({ base, rules })
  }
  return sets
}

function isIgnoredByEnclosingGitignore(resolved) {
  let dir = path.dirname(resolved)
  for (;;) {
    const rules = readGitignoreRules(dir)
    if (rules.length) {
      const relative = toPosix(path.relative(dir, resolved))
      if (relative && matchesGitignoreRules(relative, rules)) return true
    }
    if (fs.existsSync(path.join(dir, '.git'))) return false
    const parent = path.dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

export function isIgnoredByGitignore(absolutePath, ignoreSets) {
  for (const { base, rules } of ignoreSets) {
    const relative = toPosix(path.relative(base, absolutePath))
    if (!relative || relative.startsWith('..')) continue
    if (matchesGitignoreRules(relative, rules)) return true
  }
  return false
}
