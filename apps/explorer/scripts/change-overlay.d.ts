import type {
  PatchImport,
  PatchImportAddition,
  PatchSymbolAddition,
} from './patch-lib.d.ts'

export type ChangeOverlay = {
  files: string[]
  creates: string[]
  deletes: string[]
  /** Mapped files missing on disk that git did not report as deletes. */
  absent: string[]
  createFolders: string[]
  createLines: Record<string, number>
  imports: PatchImport[]
  addedFunctions: PatchSymbolAddition[]
  addedVariables: PatchSymbolAddition[]
  addedImports: PatchImportAddition[]
  changedFunctions: PatchSymbolAddition[]
  changedVariables: PatchSymbolAddition[]
}

export function emptyChangeOverlay(): ChangeOverlay
export function overlayHasChanges(overlay: unknown): boolean
export function overlayFileIds(overlay: Partial<ChangeOverlay> | null | undefined): string[]
export function normalizeChangeOverlay(value: unknown): ChangeOverlay
export function dropMassKnownCreates(
  preview: Partial<ChangeOverlay> | null | undefined,
  knownFileIds?: string[],
): ChangeOverlay
export function overlayFromPatchText(
  patchText: string,
  knownFileIds?: string[],
): ChangeOverlay
