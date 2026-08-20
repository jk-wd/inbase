import fs from 'node:fs'
import path from 'node:path'
import {
  collectImportSpecifiers,
  extractImportBindings,
  extractJsSymbols,
  resolveSpecifierAgainst,
} from './js-source.mjs'
import { targetPathPrefix } from './target-config.mjs'

export function toFileId(input) {
  if (!input || input === '/dev/null' || input === 'dev/null') return null
  let value = input.trim().replaceAll('\\', '/')
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  if (value.startsWith('a/') || value.startsWith('b/')) value = value.slice(2)
  if (targetPathPrefix) {
    const index = value.indexOf(targetPathPrefix)
    if (index >= 0) value = value.slice(index + targetPathPrefix.length)
  }
  if (value.startsWith('./')) value = value.slice(2)
  return value || null
}

function splitLines(text) {
  if (text === '') return []
  const lines = text.split('\n')
  if (text.endsWith('\n')) lines.pop()
  return lines
}

function parseHunks(section) {
  const hunks = []
  const lines = splitLines(section)
  let current = null

  for (const line of lines) {
    const header = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (header) {
      if (current) hunks.push(current)
      current = {
        oldStart: Number(header[1]),
        oldCount: Number(header[2] ?? '1'),
        newStart: Number(header[3]),
        newCount: Number(header[4] ?? '1'),
        lines: [],
      }
      continue
    }
    if (!current) continue
    if (line === '\\ No newline at end of file') continue
    if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) {
      current.lines.push(line)
    }
  }
  if (current) hunks.push(current)
  return hunks
}

function fileKind(oldPath, newPath, section) {
  if (!oldPath && newPath) return 'add'
  if (oldPath && !newPath) return 'delete'
  if (/^new file mode /m.test(section)) return 'add'
  if (/^deleted file mode /m.test(section)) return 'delete'
  return 'modify'
}

export function parseUnifiedPatch(patch) {
  const text = patch.replaceAll('\r\n', '\n')
  const files = []
  const sections = text.split(/^(?=diff --git |--- )/m).filter((part) => part.trim())

  for (const section of sections) {
    const oldMatch = section.match(/^---\s+(\S+)/m)
    const newMatch = section.match(/^\+\+\+\s+(\S+)/m)
    if (!oldMatch || !newMatch) continue

    const oldPath = toFileId(oldMatch[1])
    const newPath = toFileId(newMatch[1])
    const id = newPath || oldPath
    if (!id) continue

    const hunks = parseHunks(section)
    const kind = fileKind(oldPath, newPath, section)
    let addedLines = 0
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+')) addedLines += 1
      }
    }

    files.push({ id, kind, addedLines, hunks })
  }

  return {
    files: files.filter((file) => file.kind === 'modify').map((file) => file.id),
    creates: files.filter((file) => file.kind === 'add').map((file) => file.id),
    deletes: files.filter((file) => file.kind === 'delete').map((file) => file.id),
    createLines: Object.fromEntries(
      files
        .filter((file) => file.kind === 'add')
        .map((file) => [file.id, Math.max(1, file.addedLines)]),
    ),
    entries: files,
  }
}

export function folderOfFile(fileId) {
  return fileId.includes('/') ? fileId.split('/').slice(0, -1).join('/') : '.'
}

export function folderParent(folderPath) {
  if (!folderPath || folderPath === '.') return null
  return folderPath.includes('/') ? folderPath.split('/').slice(0, -1).join('/') : '.'
}

export function foldersFromFileIds(ids = []) {
  const folders = new Set(['.'])
  for (const id of ids) {
    let current = folderOfFile(id)
    while (current && current !== '.') {
      folders.add(current)
      current = folderParent(current) ?? '.'
    }
  }
  return folders
}

export function collectCreateFolders(creates = [], existingFolders = []) {
  const known = existingFolders instanceof Set ? existingFolders : new Set(existingFolders)
  const created = new Set()
  for (const id of creates) {
    let current = folderOfFile(id)
    while (current && current !== '.') {
      if (!known.has(current)) created.add(current)
      current = folderParent(current) ?? '.'
    }
  }
  return [...created].sort(
    (left, right) =>
      left.split('/').filter(Boolean).length - right.split('/').filter(Boolean).length ||
      left.localeCompare(right),
  )
}

function taggedSource(entry, tag) {
  const chunks = []
  for (const hunk of entry.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith(tag)) chunks.push(line.slice(1))
    }
  }
  return chunks.join('\n')
}

function addedSource(entry) {
  return taggedSource(entry, '+')
}

function removedSource(entry) {
  return taggedSource(entry, '-')
}

function extractSymbols(source) {
  // Patch previews only have function/variable buckets, so classes ride along
  // as functions rather than disappearing from the HUD.
  return extractJsSymbols(source).map((symbol) =>
    symbol.kind === 'class' ? { ...symbol, kind: 'function' } : symbol,
  )
}

function additionKey(file, name, extra = '') {
  return extra ? `${file}:${name}:${extra}` : `${file}:${name}`
}

function emptyAdditions() {
  return {
    addedFunctions: [],
    addedVariables: [],
    addedImports: [],
  }
}

function applyEntriesToAdditions(current, entries) {
  const functions = new Map(
    current.addedFunctions.map((item) => [additionKey(item.file, item.name), item]),
  )
  const variables = new Map(
    current.addedVariables.map((item) => [additionKey(item.file, item.name), item]),
  )
  const imports = new Map(
    current.addedImports.map((item) => [additionKey(item.file, item.name, item.from), item]),
  )

  const dropFile = (fileId) => {
    for (const key of [...functions.keys()]) {
      if (functions.get(key).file === fileId) functions.delete(key)
    }
    for (const key of [...variables.keys()]) {
      if (variables.get(key).file === fileId) variables.delete(key)
    }
    for (const key of [...imports.keys()]) {
      if (imports.get(key).file === fileId) imports.delete(key)
    }
  }

  for (const entry of entries) {
    if (entry.kind === 'delete') {
      dropFile(entry.id)
      continue
    }

    const removedSymbols = extractSymbols(removedSource(entry))
    const addedSymbols = extractSymbols(addedSource(entry))
    const keptSymbolKeys = new Set(
      addedSymbols.map((symbol) => `${symbol.kind}:${symbol.name}`),
    )
    const previousSymbolKeys = new Set(
      removedSymbols.map((symbol) => `${symbol.kind}:${symbol.name}`),
    )

    for (const symbol of removedSymbols) {
      if (keptSymbolKeys.has(`${symbol.kind}:${symbol.name}`)) continue
      if (symbol.kind === 'function') functions.delete(additionKey(entry.id, symbol.name))
      else variables.delete(additionKey(entry.id, symbol.name))
    }
    for (const symbol of addedSymbols) {
      if (previousSymbolKeys.has(`${symbol.kind}:${symbol.name}`)) continue
      const item = { name: symbol.name, file: entry.id }
      if (symbol.kind === 'function') functions.set(additionKey(entry.id, symbol.name), item)
      else variables.set(additionKey(entry.id, symbol.name), item)
    }

    const removedBindings = extractImportBindings(removedSource(entry))
    const addedBindings = extractImportBindings(addedSource(entry))
    const keptImportKeys = new Set(
      addedBindings.map((binding) => `${binding.name}\0${binding.from}`),
    )
    const previousImportKeys = new Set(
      removedBindings.map((binding) => `${binding.name}\0${binding.from}`),
    )

    for (const binding of removedBindings) {
      if (keptImportKeys.has(`${binding.name}\0${binding.from}`)) continue
      imports.delete(additionKey(entry.id, binding.name, binding.from))
    }
    for (const binding of addedBindings) {
      if (previousImportKeys.has(`${binding.name}\0${binding.from}`)) continue
      imports.set(additionKey(entry.id, binding.name, binding.from), {
        name: binding.name,
        from: binding.from,
        file: entry.id,
      })
    }
  }

  return {
    addedFunctions: [...functions.values()],
    addedVariables: [...variables.values()],
    addedImports: [...imports.values()],
  }
}

export function extractPatchAdditions(entries) {
  return applyEntriesToAdditions(emptyAdditions(), entries)
}

export function accumulatePatchAdditions(patches = []) {
  let additions = emptyAdditions()
  for (const patch of patches) {
    additions = applyEntriesToAdditions(additions, parseUnifiedPatch(patch).entries)
  }
  return additions
}

function folderOfFileId(fileId) {
  const index = fileId.lastIndexOf('/')
  return index === -1 ? '.' : fileId.slice(0, index)
}

function posixJoin(fromDir, specifier) {
  const raw = fromDir === '.' ? specifier : `${fromDir}/${specifier}`
  const parts = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

export function extractPatchImports(entries, knownFileIds = []) {
  const known = new Set(knownFileIds)
  for (const entry of entries) known.add(entry.id)
  const edges = []
  const seen = new Set()

  for (const entry of entries) {
    if (entry.kind === 'delete') continue
    const fromDir = folderOfFileId(entry.id)
    for (const specifier of collectImportSpecifiers(addedSource(entry))) {
      if (!specifier.startsWith('.')) continue
      const to = resolveSpecifierAgainst(posixJoin(fromDir, specifier), known)
      if (!to || to === entry.id) continue
      const key = `${entry.id}->${to}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ from: entry.id, to })
    }
  }

  return edges
}

function applyHunks(original, hunks) {
  const lines = splitLines(original)
  let delta = 0

  for (const hunk of hunks) {
    const start = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1 + delta
    const expected = []
    const replacement = []
    for (const line of hunk.lines) {
      const tag = line[0]
      const body = line.slice(1)
      if (tag === ' ' || tag === '-') expected.push(body)
      if (tag === ' ' || tag === '+') replacement.push(body)
    }
    const actual = lines.slice(start, start + expected.length)
    if (actual.join('\n') !== expected.join('\n')) {
      throw new Error(`Hunk does not apply at line ${hunk.oldStart}`)
    }
    lines.splice(start, expected.length, ...replacement)
    delta += replacement.length - expected.length
  }

  if (lines.length === 0) return original.endsWith('\n') ? '\n' : ''
  return `${lines.join('\n')}\n`
}

export function applyUnifiedPatchToContents(files, patch) {
  const parsed = parseUnifiedPatch(patch)
  if (parsed.entries.length === 0) {
    throw new Error('Patch did not contain any file changes')
  }

  for (const file of parsed.entries) {
    if (file.kind === 'delete') {
      files.delete(file.id)
      continue
    }

    const original =
      file.kind === 'add' || !files.has(file.id) ? '' : files.get(file.id)

    if (file.kind === 'modify' && original === '') {
      throw new Error(`Cannot modify missing file ${file.id}`)
    }

    files.set(file.id, applyHunks(original, file.hunks))
  }

  return parsed
}

export function applyUnifiedPatch(patch, targetRoot) {
  const parsed = parseUnifiedPatch(patch)
  if (parsed.entries.length === 0) {
    throw new Error('Patch did not contain any file changes')
  }

  const files = new Map()
  for (const file of parsed.entries) {
    const absolute = path.join(targetRoot, file.id)
    if (
      file.kind !== 'add' &&
      fs.existsSync(absolute) &&
      fs.statSync(absolute).isFile()
    ) {
      files.set(file.id, fs.readFileSync(absolute, 'utf8'))
    }
  }
  applyUnifiedPatchToContents(files, patch)

  for (const file of parsed.entries) {
    const absolute = path.join(targetRoot, file.id)
    if (file.kind === 'delete') {
      if (fs.existsSync(absolute)) fs.rmSync(absolute)
      continue
    }
    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    fs.writeFileSync(absolute, files.get(file.id))
  }

  return parsed
}

export const emptyIntent = {
  updatedAt: null,
  showMap: false,
  status: 'idle',
  feature: null,
  steps: [],
  step: null,
  files: [],
  creates: [],
  deletes: [],
  createFolders: [],
  createLines: {},
  imports: [],
  addedFunctions: [],
  addedVariables: [],
  addedImports: [],
  reason: null,
  sessionId: null,
  diffId: null,
  parentDiffId: null,
  chainIndex: null,
  chain: [],
  isActiveDiff: false,
  preview: false,
  phase: null,
  working: false,
  stalledWait: false,
  creationMode: false,
  canEnterBlueprint: false,
  blueprintSessionId: null,
  userCreatedBlocks: [],
  userCreatedIslands: [],
  blueprintFunctions: [],
  blueprintVariables: [],
  blueprintImports: [],
}

export function isLastStep(intent) {
  const steps = intent?.steps
  if (!Array.isArray(steps) || steps.length === 0) return true
  return typeof intent.step === 'number' && intent.step >= steps.length
}

export function overlayPatch(intent, patchText, knownFileIds = []) {
  const base = { ...emptyIntent, ...intent }
  const status =
    base.status === 'approved' && isLastStep(base) ? 'finished' : base.status
  const preview = status === 'pending' || status === 'extend'

  if (!preview) {
    return {
      ...base,
      status,
      files: [],
      creates: [],
      deletes: [],
      createFolders: [],
      createLines: {},
      imports: [],
      addedFunctions: [],
      addedVariables: [],
      addedImports: [],
    }
  }

  if (!patchText?.trim()) {
    return {
      ...base,
      status,
      files: base.files ?? [],
      creates: base.creates ?? [],
      deletes: base.deletes ?? [],
      createFolders: base.createFolders ?? [],
      createLines: base.createLines ?? {},
      imports: base.imports ?? [],
      addedFunctions: base.addedFunctions ?? [],
      addedVariables: base.addedVariables ?? [],
      addedImports: base.addedImports ?? [],
    }
  }

  const parsed = parseUnifiedPatch(patchText)
  return {
    ...base,
    status,
    files: parsed.files,
    creates: parsed.creates,
    deletes: parsed.deletes,
    createFolders: collectCreateFolders(
      parsed.creates,
      foldersFromFileIds(knownFileIds.filter((id) => !parsed.creates.includes(id))),
    ),
    createLines: parsed.createLines,
    imports: extractPatchImports(parsed.entries, knownFileIds),
    ...extractPatchAdditions(parsed.entries),
  }
}
