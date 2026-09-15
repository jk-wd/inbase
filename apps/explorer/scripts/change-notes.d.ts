import type { ChangeKind, ChangeOverlay } from './change-overlay.d.ts'

export function overlayFileIds(
  overlay: Partial<ChangeOverlay> | null | undefined,
): string[]
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
