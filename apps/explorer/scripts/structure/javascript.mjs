import { destructuredNames } from '../parse-idents.mjs'

export const id = 'javascript'

export const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

export function extractSymbols(source) {
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
