export {
  collectImportSpecifiers,
  extractImportBindings,
  relationAnalyzers,
} from './relations/index.mjs'

export {
  extractSymbols,
  structureAnalyzers,
} from './structure/index.mjs'

export { extensions as SOURCE_EXTENSIONS, extractSymbols as extractJsSymbols } from './structure/javascript.mjs'

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

function firstKnownWithPrefix(prefix, known) {
  for (const id of known) {
    if (!id.startsWith(prefix)) continue
    if (id.slice(prefix.length).includes('/')) continue
    return id
  }
  return null
}

export function resolveSpecifierAgainst(candidate, known) {
  if (known.has(candidate)) return candidate
  for (const ext of RESOLVE_EXTENSIONS) {
    if (known.has(candidate + ext)) return candidate + ext
  }
  const withExt = firstKnownWithPrefix(`${candidate}.`, known)
  if (withExt) return withExt
  for (const ext of RESOLVE_EXTENSIONS) {
    const indexFile = `${candidate}/index${ext}`
    if (known.has(indexFile)) return indexFile
  }
  return firstKnownWithPrefix(`${candidate}/index.`, known)
}
