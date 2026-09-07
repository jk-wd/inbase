import type { PatchImport, PatchImportAddition, PatchSymbolAddition } from './patch-lib.d.ts'

export type BranchChangesMode = 'main' | 'remote'

export type BranchChanges = {
  available: boolean
  branch: string | null
  base: string | null
  mode: BranchChangesMode
  remoteMissing: boolean
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
export function emptyBranchChanges(): BranchChanges
export function readBranchChanges(
  targetRoot: string,
  knownFileIds?: string[],
  modeInput?: unknown,
): BranchChanges
