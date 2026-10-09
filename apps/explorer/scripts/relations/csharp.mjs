import { stripCSharpTrivia } from '../structure/csharp.mjs'

export const id = 'csharp'

export const extensions = new Set(['.cs'])

const USING_DIRECTIVE =
  /^\s*(?:global\s+)?using\s+(?!var\b)(static\s+)?(?:([A-Za-z_]\w*)\s*=\s*)?([A-Za-z_][\w.]*)\s*;/gm

export function declaredNamespace(source) {
  const stripped = stripCSharpTrivia(source)
  const fileScoped = stripped.match(/^\s*namespace\s+([A-Za-z_][\w.]*)\s*;/m)
  if (fileScoped) return fileScoped[1]
  const block = stripped.match(/^\s*namespace\s+([A-Za-z_][\w.]*)\s*\{/m)
  return block?.[1] ?? ''
}

export function collectUsings(source) {
  const usings = []
  const seen = new Set()
  for (const match of source.matchAll(USING_DIRECTIVE)) {
    const name = match[3]
    if (!name) continue
    const kind = match[1] || match[2] ? 'type' : 'namespace'
    const key = `${kind}\0${name}`
    if (seen.has(key)) continue
    seen.add(key)
    usings.push({ kind, name })
  }
  return usings
}

export function collectSpecifiers(source) {
  return collectUsings(source).map((item) => item.name)
}

export function extractBindings(source) {
  return collectUsings(source).map((item) => ({
    name: item.name.split('.').pop(),
    from: item.name,
  }))
}

function addIndex(map, key, id) {
  if (!key) return
  const list = map.get(key) ?? []
  if (!list.includes(id)) list.push(id)
  map.set(key, list)
}

export function applyCSharpImports(files, sources) {
  const namespaceFiles = new Map()
  const typeFiles = new Map()
  for (const file of files) {
    if (!file.id.endsWith('.cs')) continue
    const source = sources.get(file.id)
    if (typeof source !== 'string') continue
    const namespace = declaredNamespace(source)
    addIndex(namespaceFiles, namespace, file.id)
    for (const symbol of file.symbols ?? []) {
      if (symbol.kind !== 'class') continue
      const qualified = namespace ? `${namespace}.${symbol.name}` : symbol.name
      addIndex(typeFiles, qualified, file.id)
    }
  }

  for (const file of files) {
    if (!file.id.endsWith('.cs')) continue
    const source = sources.get(file.id)
    if (typeof source !== 'string') continue
    const targets = []
    for (const item of collectUsings(source)) {
      const hits =
        item.kind === 'type'
          ? (typeFiles.get(item.name) ?? namespaceFiles.get(item.name) ?? [])
          : (namespaceFiles.get(item.name) ?? [])
      for (const id of hits) {
        if (id !== file.id) targets.push(id)
      }
    }
    if (targets.length === 0) continue
    file.imports = [...new Set([...(file.imports ?? []), ...targets])]
  }
}
