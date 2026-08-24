import type { PatchImport, PatchImportAddition, PatchSymbolAddition } from './patch-lib.d.ts'

export type BranchChanges = {
  available: boolean
  branch: string | null
  base: string | null
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

export function emptyBranchChanges(): BranchChanges
export function readBranchChanges(
  targetRoot: string,
  knownFileIds?: string[],
): BranchChanges
