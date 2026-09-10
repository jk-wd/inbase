import type { ChangeOverlay } from './change-overlay.d.ts'
import type { PatchImport, PatchImportAddition, PatchSymbolAddition } from './patch-lib.d.ts'

export type BranchRef = {
  name: string
  remote: boolean
}

export type BranchChanges = {
  available: boolean
  branch: string | null
  base: string | null
  current: boolean
  branches: BranchRef[]
  baseMissing: boolean
  files: string[]
  creates: string[]
  deletes: string[]
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

export function normalizeBranchChangesBase(value: unknown): string | null
export function listCompareBranches(
  gitRoot: string,
  current?: string | null,
): BranchRef[]
export function emptyBranchChanges(): BranchChanges
export function hasGitRepo(targetRoot: string | null | undefined): boolean
export function withAbsentMappedFiles(
  overlay: Partial<ChangeOverlay> | null | undefined,
  targetRoot: string | null | undefined,
  knownFileIds?: string[],
): ChangeOverlay
export function readWorkingTreeChanges(
  targetRoot: string,
  knownFileIds?: string[],
): ChangeOverlay
export function readBranchChanges(
  targetRoot: string,
  knownFileIds?: string[],
  baseInput?: unknown,
): BranchChanges
