import path from 'node:path'
import * as javascript from './javascript.mjs'

/** Ordered structure analyzers. Add a module here for a new language. */
export const structureAnalyzers = [javascript]

export function analyzerApplies(analyzer, filePath) {
  if (!analyzer.extensions || analyzer.extensions.size === 0) return true
  if (!filePath) return true
  const ext = path.extname(filePath).toLowerCase()
  return analyzer.extensions.has(ext)
}

export function extractSymbols(source, filePath) {
  const symbols = []
  const seen = new Set()
  for (const analyzer of structureAnalyzers) {
    if (!analyzerApplies(analyzer, filePath)) continue
    for (const symbol of analyzer.extractSymbols(source)) {
      if (seen.has(symbol.name)) continue
      seen.add(symbol.name)
      symbols.push(symbol)
    }
  }
  return symbols
}
