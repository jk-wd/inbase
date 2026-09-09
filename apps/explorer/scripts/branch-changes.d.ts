import type { ChangeOverlay } from './change-overlay.d.ts'
import type { PatchImport, PatchImportAddition, PatchSymbolAddition } from './patch-lib.d.ts'

export type BranchChangesMode = 'main' | 'remote' | 'current' | 'commit'

export type BranchCommit = {
  sha: string
  short: string
  subject: string
}

export type BranchChanges = {
  available: boolean
  branch: string | null
  base: string | null
  mode: BranchChangesMode
  remoteMissing: boolean
  commit: BranchCommit | null
  commits: BranchCommit[]
  commitMissing: boolean
  files: string[]
  creates: string[]
  deletes: string[]
  createFolders: string[]
  createLines: Record<string, number>
  imports: PatchImport[]
  addedFunctions: PatchSymbolAddition[]
  addedVariables: PatchSymbolAddition[]
  addedImports: PatchImportAddition[]
  changedFunctions: PatchSymbolAddition[]
  changedVariables: PatchSymbolAddition[]
}

export function normalizeBranchChangesMode(value: unknown): BranchChangesMode
export function normalizeBranchChangesCommit(value: unknown): string | null
export function listBranchCommits(targetRoot: string): BranchCommit[]
export function emptyBranchChanges(): BranchChanges
export function hasGitRepo(targetRoot: string | null | undefined): boolean
export function readWorkingTreeChanges(
  targetRoot: string,
  knownFileIds?: string[],
): ChangeOverlay
export function readBranchChanges(
  targetRoot: string,
  knownFileIds?: string[],
  modeInput?: unknown,
  commitInput?: unknown,
): BranchChanges
