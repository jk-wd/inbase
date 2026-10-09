import path from 'node:path'
import * as csharp from './csharp.mjs'
import * as javascript from './javascript.mjs'

/** Ordered structure analyzers. Add a module here for a new language. */
export const structureAnalyzers = [javascript, csharp]

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
      const key = `${symbol.kind}\0${symbol.class ?? ''}\0${symbol.name}`
      if (seen.has(key)) continue
      seen.add(key)
      symbols.push(symbol)
    }
  }
  return symbols
}
