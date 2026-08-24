import type { BranchChanges } from './types'

export const emptyBranchChanges: BranchChanges = {
  available: false,
  branch: null,
  base: null,
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

function normalize(data: Partial<BranchChanges> | null | undefined): BranchChanges {
  return {
    available: Boolean(data?.available),
    branch: typeof data?.branch === 'string' ? data.branch : null,
    base: typeof data?.base === 'string' ? data.base : null,
    files: Array.isArray(data?.files) ? data.files : [],
    creates: Array.isArray(data?.creates) ? data.creates : [],
    deletes: Array.isArray(data?.deletes) ? data.deletes : [],
    createFolders: Array.isArray(data?.createFolders) ? data.createFolders : [],
    createLines:
      data?.createLines && typeof data.createLines === 'object'
        ? data.createLines
        : {},
    imports: Array.isArray(data?.imports) ? data.imports : [],
    addedFunctions: Array.isArray(data?.addedFunctions) ? data.addedFunctions : [],
    addedVariables: Array.isArray(data?.addedVariables) ? data.addedVariables : [],
    addedImports: Array.isArray(data?.addedImports) ? data.addedImports : [],
    changedFunctions: Array.isArray(data?.changedFunctions)
      ? data.changedFunctions
      : [],
    changedVariables: Array.isArray(data?.changedVariables)
      ? data.changedVariables
      : [],
  }
}

export async function fetchBranchChanges(): Promise<BranchChanges> {
  try {
    const response = await fetch(`/api/branch-changes?t=${Date.now()}`)
    if (!response.ok) return emptyBranchChanges
    return normalize((await response.json()) as BranchChanges)
  } catch {
    return emptyBranchChanges
  }
}
