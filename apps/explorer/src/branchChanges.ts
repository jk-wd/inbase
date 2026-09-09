import type {
  BranchChanges,
  BranchChangesMode,
  BranchCommit,
} from './types'

function normalizeCommit(data: unknown): BranchCommit | null {
  if (!data || typeof data !== 'object') return null
  const commit = data as Partial<BranchCommit>
  if (typeof commit.sha !== 'string' || typeof commit.short !== 'string') {
    return null
  }
  return {
    sha: commit.sha,
    short: commit.short,
    subject: typeof commit.subject === 'string' ? commit.subject : '',
  }
}

export const emptyBranchChanges: BranchChanges = {
  available: false,
  branch: null,
  base: null,
  mode: 'main',
  remoteMissing: false,
  commit: null,
  commits: [],
  commitMissing: false,
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

function normalizeMode(value: unknown): BranchChangesMode {
  if (
    value === 'remote' ||
    value === 'current' ||
    value === 'commit'
  ) {
    return value
  }
  return 'main'
}

function normalize(data: Partial<BranchChanges> | null | undefined): BranchChanges {
  return {
    available: Boolean(data?.available),
    branch: typeof data?.branch === 'string' ? data.branch : null,
    base: typeof data?.base === 'string' ? data.base : null,
    mode: normalizeMode(data?.mode),
    remoteMissing: Boolean(data?.remoteMissing),
    commit: normalizeCommit(data?.commit),
    commits: Array.isArray(data?.commits)
      ? data.commits
          .map((item) => normalizeCommit(item))
          .filter((item): item is BranchCommit => Boolean(item))
      : [],
    commitMissing: Boolean(data?.commitMissing),
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

export async function fetchBranchChanges(
  mode: BranchChangesMode = 'main',
  commit: string | null = null,
): Promise<BranchChanges> {
  try {
    const params = new URLSearchParams({
      mode,
      t: String(Date.now()),
    })
    if (commit) params.set('commit', commit)
    const response = await fetch(`/api/branch-changes?${params.toString()}`)
    if (!response.ok) return emptyBranchChanges
    return normalize((await response.json()) as BranchChanges)
  } catch {
    return emptyBranchChanges
  }
}
