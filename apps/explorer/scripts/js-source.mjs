export const FILE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.json',
  '.html',
  '.md',
])

export const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

export const RESOLVE_EXTENSIONS = [
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.scss',
  '.json',
]

export function extractJsSymbols(source) {
  const symbols = []
  const seen = new Set()

  const add = (name, kind) => {
    if (!name || seen.has(name)) return
    seen.add(name)
    symbols.push({ name, kind })
  }

  for (const match of source.matchAll(/\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) {
    add(match[1], 'function')
  }

  for (const match of source.matchAll(
    /\b(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
  )) {
    add(match[1], 'class')
  }

  for (const match of source.matchAll(
    /(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
  )) {
    add(match[1], 'function')
  }

  for (const match of source.matchAll(/(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    add(match[1], 'variable')
  }

  for (const match of source.matchAll(
    /(?:export\s+)?(?:const|let|var)\s+(\[[^\]]+\]|\{[^}]+\})/g,
  )) {
    for (const ident of destructuredNames(match[1])) add(ident, 'variable')
  }

  return symbols
}

export function collectImportSpecifiers(source) {
  const specifiers = new Set()
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    specifiers.add(match[1])
  }
  for (const match of source.matchAll(/import\s+['"]([^'"]+)['"]/g)) {
    specifiers.add(match[1])
  }
  for (const match of source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specifiers.add(match[1])
  }
  return [...specifiers]
}

export function extractImportBindings(source) {
  const bindings = []
  const seen = new Set()

  const add = (name, from) => {
    const ident = name?.trim()
    const specifier = from?.trim()
    if (!ident || !specifier) return
    const key = `${ident}\0${specifier}`
    if (seen.has(key)) return
    seen.add(key)
    bindings.push({ name: ident, from: specifier })
  }

  for (const match of source.matchAll(/^[ \t]*import\s+['"]([^'"]+)['"]/gm)) {
    add(match[1], match[1])
  }

  for (const match of source.matchAll(
    /^[ \t]*import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm,
  )) {
    const clause = match[1].trim()
    const from = match[2]
    const star = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)/)
    if (star) {
      add(star[1], from)
      continue
    }

    const named = clause.match(/\{([^}]*)\}/)
    const defaultPart = clause
      .replace(/\{[^}]*\}/, '')
      .replace(/,/g, '')
      .replace(/^type\s+/, '')
      .trim()
    if (defaultPart && /^[A-Za-z_$][\w$]*$/.test(defaultPart)) {
      add(defaultPart, from)
    }
    if (!named) continue
    for (const ident of destructuredNames(`{${named[1]}}`, { importClause: true })) {
      add(ident, from)
    }
  }

  const boundRequires = new Set()

  for (const match of source.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g,
  )) {
    add(match[1], match[2])
    boundRequires.add(match[2])
  }

  for (const match of source.matchAll(
    /\b(?:const|let|var)\s+(\{[^}]+\}|\[[^\]]+\])\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g,
  )) {
    boundRequires.add(match[2])
    for (const ident of destructuredNames(match[1])) add(ident, match[2])
  }

  for (const match of source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (boundRequires.has(match[1])) continue
    add(match[1], match[1])
  }

  return bindings
}

export function resolveSpecifierAgainst(candidate, known) {
  if (known.has(candidate)) return candidate
  for (const ext of RESOLVE_EXTENSIONS) {
    if (known.has(candidate + ext)) return candidate + ext
  }
  for (const ext of RESOLVE_EXTENSIONS) {
    const indexFile = `${candidate}/index${ext}`
    if (known.has(indexFile)) return indexFile
  }
  return null
}

function destructuredNames(pattern, { importClause = false } = {}) {
  const names = []
  const inner = pattern.slice(1, -1)
  for (const part of inner.split(',')) {
    let token = part.trim()
    if (!token) continue
    token = token.replace(/^\.\.\./, '')
    if (importClause) {
      const aliased = token.match(/^(?:type\s+)?[A-Za-z_$][\w$]*\s+as\s+([A-Za-z_$][\w$]*)$/)
      if (aliased) {
        names.push(aliased[1])
        continue
      }
      const ident = token.replace(/^type\s+/, '').trim()
      if (/^[A-Za-z_$][\w$]*$/.test(ident)) names.push(ident)
      continue
    }
    const aliased = token.match(/^[A-Za-z_$][\w$]*\s*:\s*([A-Za-z_$][\w$]*)/)
    if (aliased) {
      names.push(aliased[1])
      continue
    }
    const ident = token.split(/\s*=/)[0].trim()
    if (/^[A-Za-z_$][\w$]*$/.test(ident)) names.push(ident)
  }
  return names
}
