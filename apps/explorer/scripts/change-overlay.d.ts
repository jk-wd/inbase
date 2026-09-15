import type {
  PatchImport,
  PatchImportAddition,
  PatchSymbolAddition,
} from './patch-lib.d.ts'

export type ChangeKind = 'add' | 'edit' | 'remove'

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
  /** LLM one-liners keyed by file or folder path. */
  changeNotes: Record<string, string>
}

export function emptyChangeOverlay(): ChangeOverlay
export function overlayHasChanges(overlay: unknown): boolean
export function overlayFileIds(overlay: Partial<ChangeOverlay> | null | undefined): string[]
export function asChangeNotes(value: unknown): Record<string, string>
export function parseChangeNoteFlag(
  value: unknown,
): { path: string; note: string } | null
export function parseChangeNoteFlags(
  values: Iterable<string> | null | undefined,
): Record<string, string>
export function pathIsUnderFolder(fileId: string, folderPath: string): boolean
export function changeNotePathRelevant(
  overlay: Partial<ChangeOverlay> | null | undefined,
  path: string,
): boolean
export function attachChangeNotes(
  overlay: Partial<ChangeOverlay> | null | undefined,
  notes?: Record<string, string> | null,
): ChangeOverlay
export function mergeChangeNotes(
  live: Partial<ChangeOverlay> | null | undefined,
  stored: Partial<ChangeOverlay> | null | undefined,
): ChangeOverlay
export function overlayPathChangeKind(
  overlay: Partial<ChangeOverlay> | null | undefined,
  path: string,
  folder?: boolean,
): ChangeKind | null
export function synthesizeFileNote(
  overlay: Partial<ChangeOverlay> | null | undefined,
  fileId: string,
  reason?: string | null,
): string
export function synthesizeFolderNote(
  overlay: Partial<ChangeOverlay> | null | undefined,
  folderPath: string,
  reason?: string | null,
): string
export function llmChangeNoteForPath(
  overlay: Partial<ChangeOverlay> | null | undefined,
  path: string,
  options?: { folder?: boolean; reason?: string | null },
): string
export function formatLlmChangeLine(input: {
  kind?: ChangeKind | null
  colorName?: string | null
  note?: string | null
}): string
export function normalizeChangeOverlay(value: unknown): ChangeOverlay
export function dropMassKnownCreates(
  preview: Partial<ChangeOverlay> | null | undefined,
  knownFileIds?: string[],
): ChangeOverlay
export function overlayFromPatchText(
  patchText: string,
  knownFileIds?: string[],
): ChangeOverlay
