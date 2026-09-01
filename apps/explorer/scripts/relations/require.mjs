import { destructuredNames } from '../parse-idents.mjs'

export const id = 'require'

/** `null` means run on every text file. Later analyzers can list extensions. */
export const extensions = null

export function collectSpecifiers(source) {
  const specifiers = []
  for (const match of source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specifiers.push(match[1])
  }
  return specifiers
}

export function extractBindings(source) {
  const bindings = []
  const seen = new Set()
  const boundRequires = new Set()

  const add = (name, from) => {
    const ident = name?.trim()
    const specifier = from?.trim()
    if (!ident || !specifier) return
    const key = `${ident}\0${specifier}`
    if (seen.has(key)) return
    seen.add(key)
    bindings.push({ name: ident, from: specifier })
  }

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
