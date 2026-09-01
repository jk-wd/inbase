import path from 'node:path'
import * as esm from './esm.mjs'
import * as html from './html.mjs'
import * as cjsRequire from './require.mjs'

/** Ordered relation analyzers. Add a module here for a new import style or language. */
export const relationAnalyzers = [esm, cjsRequire, html]

export function analyzerApplies(analyzer, filePath) {
  if (!analyzer.extensions || analyzer.extensions.size === 0) return true
  if (!filePath) return true
  const ext = path.extname(filePath).toLowerCase()
  return analyzer.extensions.has(ext)
}

export function collectImportSpecifiers(source, filePath) {
  const specifiers = new Set()
  for (const analyzer of relationAnalyzers) {
    if (!analyzerApplies(analyzer, filePath)) continue
    for (const specifier of analyzer.collectSpecifiers(source)) {
      specifiers.add(specifier)
    }
  }
  return [...specifiers]
}

export function extractImportBindings(source, filePath) {
  const bindings = []
  const seen = new Set()
  for (const analyzer of relationAnalyzers) {
    if (!analyzerApplies(analyzer, filePath)) continue
    if (typeof analyzer.extractBindings !== 'function') continue
    for (const binding of analyzer.extractBindings(source)) {
      const key = `${binding.name}\0${binding.from}`
      if (seen.has(key)) continue
      seen.add(key)
      bindings.push(binding)
    }
  }
  return bindings
}
