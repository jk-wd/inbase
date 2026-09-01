import { destructuredNames } from '../parse-idents.mjs'

export const id = 'esm'

/** `null` means run on every text file. Later analyzers can list extensions. */
export const extensions = null

export function collectSpecifiers(source) {
  const specifiers = new Set()
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    specifiers.add(match[1])
  }
  for (const match of source.matchAll(/import\s+['"]([^'"]+)['"]/g)) {
    specifiers.add(match[1])
  }
  return [...specifiers]
}

export function extractBindings(source) {
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

  return bindings
}
