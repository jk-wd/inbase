import type { LocalBlueprint, SessionBlueprint } from './session-store.d.ts'

export const BLUEPRINTS_DIR_NAME: 'blueprints'
export const BLUEPRINT_KIND: 'blueprint'
export const BLUEPRINT_VERSION: 1
export const WRAPPER_KIND: 'inbase-wrapper'
export const WRAPPER_VERSION: 1
export const BLUEPRINT_FILE_SUFFIX: '.blueprint.json'
export const WRAPPER_FILE_SUFFIX: '-wrapper.json'

export type BlueprintContent = {
  files: unknown[]
  folders: unknown[]
  functions: unknown[]
  classes: unknown[]
  variables: unknown[]
  imports: unknown[]
  notes: unknown[]
  pointers: unknown[]
  deleted: string[]
  steps: string[]
}

export type BlueprintSetLayer = BlueprintContent & {
  color: string
  colorName: string
  colorHex: string
  hidden: boolean
  dependsOn: string[]
}

export type BlueprintSet = {
  name: string
  savedAt: string
  blueprints: BlueprintSetLayer[]
}

export type BlueprintFile = BlueprintContent & {
  version: typeof BLUEPRINT_VERSION
  kind: typeof BLUEPRINT_KIND
  name: string
}

export type BlueprintWrapper = {
  version: typeof WRAPPER_VERSION
  kind: typeof WRAPPER_KIND
  name: string
  savedAt: string
  blueprints: Array<{
    color: string
    file: string
    hidden: boolean
    dependsOn: string[]
  }>
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

type SetInput = {
  name?: string
  savedAt?: string
  blueprints?: unknown
  /** @deprecated use `blueprints` */
  locals?: unknown
  /** @deprecated folded into the first session color when it is not in `blueprints` */
  global?: Partial<BlueprintContent> | null
}

export function defaultBlueprintsDir(targetRoot: string): string
export function blueprintSubjectSlug(value: string): string
export function nextNumberedBlueprintSet(
  targetRoot: string,
  subject: string,
): {
  subject: string
  number: number
  name: string
  folderPath: string
}
export function blueprintSetName(name: string): string
export function wrapperFileName(setName: string): string
export function blueprintFileNameFor(setName: string, color: string, single: boolean): string
export function resolveBlueprintSetFolder(
  targetRoot: string,
  input?: {
    name?: string
    directory?: string
    folder?: string
    filePath?: string
  },
): string
export function normalizeBlueprintSet(input?: SetInput): BlueprintSet
export function serializeBlueprintFile(name: string, layer: unknown): BlueprintFile
export function serializeBlueprintSet(input?: SetInput): {
  name: string
  savedAt: string
  wrapperFileName: string
  wrapper: BlueprintWrapper
  files: Array<{ color: string; fileName: string; document: BlueprintFile }>
}
export function parseBlueprintFile(value: unknown): BlueprintContent & { name: string | null }
export function parseWrapper(value: unknown): BlueprintWrapper
export function parseBlueprintSet(
  wrapper: unknown,
  readFile: (fileName: string) => unknown,
): BlueprintSet
export function parseBlueprintDocument(value: unknown): BlueprintSet
export function parseBlueprintDocuments(
  documents: Array<{ fileName?: string; document: unknown }>,
): BlueprintSet
export function readBlueprintSetFromPath(filePath: string): {
  set: BlueprintSet
  path: string
}
export function listSavedBlueprints(targetRoot: string): SavedBlueprintList
export function saveBlueprintDocument(
  targetRoot: string,
  input?: SetInput & {
    directory?: string
    folder?: string
    filePath?: string
  },
): SavedBlueprintInfo & {
  fileName: string
  savedAt: string
  path: string
  relativePath: string
  folder: string
  blueprintFiles: Array<{ color: string; path: string; relativePath: string }>
}
export function readBlueprintDocument(
  targetRoot: string,
  input?: { name?: string; filePath?: string },
): SavedBlueprintInfo & {
  document: BlueprintSet
  fileName: string
  savedAt: string
  path: string
  relativePath: string
}
export function applyBlueprintDocument(
  dataDir: string,
  document: unknown,
  options?: { targetRoot?: string | null; existingFileIds?: string[] },
): {
  name: string
  global: SessionBlueprint
  localBlueprints: LocalBlueprint[]
}
export function loadBlueprintDocument(
  targetRoot: string,
  dataDir: string,
  input?: {
    name?: string
    filePath?: string
    document?: unknown
    documents?: Array<{ fileName?: string; document: unknown }>
  },
): SavedBlueprintInfo & {
  name: string
  global: SessionBlueprint
  localBlueprints: LocalBlueprint[]
}
