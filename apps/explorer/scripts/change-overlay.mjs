import {
  collectCreateFolders,
  extractPatchAdditions,
  extractPatchImports,
  foldersFromFileIds,
  parseUnifiedPatch,
} from './patch-lib.mjs'

export function emptyChangeOverlay() {
  return {
    files: [],
    creates: [],
    deletes: [],
    createFolders: [],
    createLines: {},
    imports: [],
    addedFunctions: [],
    addedVariables: [],
    addedImports: [],
    changedFunctions: [],
    changedVariables: [],
  }
}

export function overlayHasChanges(overlay) {
  return (
    (overlay?.files?.length ?? 0) > 0 ||
    (overlay?.creates?.length ?? 0) > 0 ||
    (overlay?.deletes?.length ?? 0) > 0
  )
}

export function overlayFileIds(overlay) {
  return [
    ...new Set([
      ...(overlay?.files ?? []),
      ...(overlay?.creates ?? []),
      ...(overlay?.deletes ?? []),
    ]),
  ]
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item)
    : []
}

function asSymbolList(value) {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item) =>
      item &&
      typeof item === 'object' &&
      typeof item.name === 'string' &&
      typeof item.file === 'string',
  )
}

function asImportEdges(value) {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item) =>
      item &&
      typeof item === 'object' &&
      typeof item.from === 'string' &&
      typeof item.to === 'string',
  )
}

function asImportAdditions(value) {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item) =>
      item &&
      typeof item === 'object' &&
      typeof item.name === 'string' &&
      typeof item.from === 'string' &&
      typeof item.file === 'string',
  )
}

export function normalizeChangeOverlay(value) {
  const overlay = value && typeof value === 'object' ? value : {}
  const createLines =
    overlay.createLines &&
    typeof overlay.createLines === 'object' &&
    !Array.isArray(overlay.createLines)
      ? overlay.createLines
      : {}
  return {
    files: asStringArray(overlay.files),
    creates: asStringArray(overlay.creates),
    deletes: asStringArray(overlay.deletes),
    createFolders: asStringArray(overlay.createFolders),
    createLines,
    imports: asImportEdges(overlay.imports),
    addedFunctions: asSymbolList(overlay.addedFunctions),
    addedVariables: asSymbolList(overlay.addedVariables),
    addedImports: asImportAdditions(overlay.addedImports),
    changedFunctions: asSymbolList(overlay.changedFunctions),
    changedVariables: asSymbolList(overlay.changedVariables),
  }
}

export function dropMassKnownCreates(preview, knownFileIds = []) {
  const known = new Set(knownFileIds)
  const overlay = normalizeChangeOverlay(preview)
  const overlap = overlay.creates.filter((id) => known.has(id))
  const massFalseAdd =
    overlap.length >= 20 && overlap.length >= Math.max(10, known.size * 0.15)
  const drop = massFalseAdd ? new Set(overlap) : new Set()
  const creates = overlay.creates.filter((id) => !drop.has(id))
  const createLines = Object.fromEntries(
    Object.entries(overlay.createLines).filter(([id]) => !drop.has(id)),
  )
  const keepSymbol = (item) => !drop.has(item.file)
  return {
    ...overlay,
    creates,
    createLines,
    createFolders: collectCreateFolders(
      creates,
      foldersFromFileIds(knownFileIds.filter((id) => !creates.includes(id))),
    ),
    imports: overlay.imports.filter(
      (edge) => !drop.has(edge.from) && !drop.has(edge.to),
    ),
    addedFunctions: overlay.addedFunctions.filter(keepSymbol),
    addedVariables: overlay.addedVariables.filter(keepSymbol),
    addedImports: overlay.addedImports.filter(keepSymbol),
    changedFunctions: overlay.changedFunctions.filter(keepSymbol),
    changedVariables: overlay.changedVariables.filter(keepSymbol),
  }
}

export function overlayFromPatchText(patchText, knownFileIds = []) {
  const parsed = parseUnifiedPatch(patchText ?? '')
  return dropMassKnownCreates(
    {
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
    },
    knownFileIds,
  )
}
