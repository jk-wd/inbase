import type { LocalBlueprint, SessionBlueprint } from './session-store.d.ts'

export const BLUEPRINTS_DIR_NAME: 'blueprints'
export const BLUEPRINT_DOCUMENT_KIND: 'inbase-blueprint'
export const BLUEPRINT_DOCUMENT_VERSION: 1

export type BlueprintLayerFields = {
  hidden: boolean
  files: unknown[]
  folders: unknown[]
  addedFunctions: unknown[]
  addedVariables: unknown[]
  addedImports: unknown[]
  notes: unknown[]
  pointers: unknown[]
}

export type BlueprintDocumentLocal = BlueprintLayerFields & {
  color: string
  colorName: string
  colorHex: string
}

export type BlueprintDocument = {
  version: number
  kind: typeof BLUEPRINT_DOCUMENT_KIND
  name: string
  savedAt: string
  global: BlueprintLayerFields
  locals: BlueprintDocumentLocal[]
}

export type SavedBlueprintInfo = {
  name: string
  fileName: string | null
  savedAt: string | null
  path: string | null
  relativePath: string | null
}

export type SavedBlueprintList = {
  directory: string
  items: Array<
    SavedBlueprintInfo & {
      fileName: string
      savedAt: string
      path: string
      relativePath: string
    }
  >
}

export function defaultBlueprintsDir(targetRoot: string): string
export function blueprintFileName(name: string): string
export function resolveBlueprintSavePath(
  targetRoot: string,
  input?: {
    name?: string
    directory?: string
    filePath?: string
  },
): string
export function serializeBlueprintDocument(input?: {
  name?: string
  savedAt?: string
  global?: Partial<BlueprintLayerFields> | null
  locals?: unknown
}): BlueprintDocument
export function parseBlueprintDocument(value: unknown): BlueprintDocument
export function listSavedBlueprints(targetRoot: string): SavedBlueprintList
export function saveBlueprintDocument(
  targetRoot: string,
  input?: {
    name?: string
    directory?: string
    filePath?: string
    savedAt?: string
    global?: Partial<BlueprintLayerFields> | null
    locals?: unknown
  },
): SavedBlueprintInfo & {
  fileName: string
  savedAt: string
  path: string
  relativePath: string
}
export function readBlueprintDocument(
  targetRoot: string,
  input?: { name?: string; filePath?: string },
): SavedBlueprintInfo & {
  document: BlueprintDocument
  fileName: string
  savedAt: string
  path: string
  relativePath: string
}
export function applyBlueprintDocument(
  dataDir: string,
  document: unknown,
): {
  name: string
  global: SessionBlueprint
  localBlueprints: LocalBlueprint[]
}
export function loadBlueprintDocument(
  targetRoot: string,
  dataDir: string,
  input?: { name?: string; filePath?: string; document?: unknown },
): SavedBlueprintInfo & {
  name: string
  global: SessionBlueprint
  localBlueprints: LocalBlueprint[]
}
