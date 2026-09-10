import type { BranchChanges, BranchRef } from './types'

export const emptyBranchChanges: BranchChanges = {
  available: false,
  branch: null,
  base: null,
  current: true,
  branches: [],
  baseMissing: false,
  files: [],
  creates: [],
  deletes: [],
  absent: [],
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
    current: data?.current !== false,
    branches: Array.isArray(data?.branches)
      ? data.branches
          .map((item): BranchRef | null => {
            if (typeof item === 'string') return { name: item, remote: false }
            if (!item || typeof item !== 'object') return null
            if (typeof item.name !== 'string' || !item.name) return null
            return { name: item.name, remote: Boolean(item.remote) }
          })
          .filter((item): item is BranchRef => Boolean(item))
      : [],
    baseMissing: Boolean(data?.baseMissing),
    files: Array.isArray(data?.files) ? data.files : [],
    creates: Array.isArray(data?.creates) ? data.creates : [],
    deletes: Array.isArray(data?.deletes) ? data.deletes : [],
    absent: Array.isArray(data?.absent) ? data.absent : [],
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

export async function fetchBranchChanges(
  base: string | null = null,
): Promise<BranchChanges> {
  try {
    const params = new URLSearchParams({
      t: String(Date.now()),
    })
    if (base) params.set('base', base)
    const response = await fetch(`/api/branch-changes?${params.toString()}`)
    if (!response.ok) return emptyBranchChanges
    return normalize((await response.json()) as BranchChanges)
  } catch {
    return emptyBranchChanges
  }
}
