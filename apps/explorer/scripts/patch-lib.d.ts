export type PatchImport = {
  from: string
  to: string
}

export type PatchSymbolAddition = {
  name: string
  file: string
}

export type PatchImportAddition = {
  name: string
  from: string
  file: string
}

export function parseUnifiedPatch(patch: string): {
  files: string[]
  creates: string[]
  deletes: string[]
  createLines: Record<string, number>
  entries: Array<{
    id: string
    kind: 'add' | 'modify' | 'delete'
    addedLines: number
    hunks: unknown[]
  }>
}

export function extractPatchImports(
  entries: Array<{
    id: string
    kind: 'add' | 'modify' | 'delete'
    hunks: unknown[]
  }>,
  knownFileIds?: string[],
): PatchImport[]

export function extractPatchAdditions(
  entries: Array<{
    id: string
    kind: 'add' | 'modify' | 'delete'
    hunks: unknown[]
  }>,
): {
  addedFunctions: PatchSymbolAddition[]
  addedVariables: PatchSymbolAddition[]
  addedImports: PatchImportAddition[]
  changedFunctions: PatchSymbolAddition[]
  changedVariables: PatchSymbolAddition[]
}

export function accumulatePatchAdditions(patches?: string[]): {
  addedFunctions: PatchSymbolAddition[]
  addedVariables: PatchSymbolAddition[]
  addedImports: PatchImportAddition[]
  changedFunctions: PatchSymbolAddition[]
  changedVariables: PatchSymbolAddition[]
}

export function applyUnifiedPatchToContents(
  files: Map<string, string>,
  patch: string,
): ReturnType<typeof parseUnifiedPatch>

export function applyUnifiedPatch(
  patch: string,
  targetRoot: string,
): ReturnType<typeof parseUnifiedPatch>

export function folderOfFile(fileId: string): string
export function folderParent(folderPath: string): string | null
export function foldersFromFileIds(ids?: string[]): Set<string>
export function collectCreateFolders(
  creates?: string[],
  existingFolders?: Iterable<string>,
): string[]

export const emptyIntent: {
  updatedAt: null
  showMap: boolean
  status: string
  feature: null
  steps: unknown[]
  step: null
  stepByStep: boolean
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
  reason: null
  sessionId: null
  diffId: null
  parentDiffId: null
  chainIndex: null
  chain: unknown[]
  isActiveDiff: boolean
  preview: boolean
  phase: null
  working: boolean
  stalledWait: boolean
  llmIdle: boolean
  creationMode: boolean
  canEnterBlueprint: boolean
  blueprintSessionId: string | null
  userCreatedBlocks: unknown[]
  userCreatedIslands: unknown[]
  blueprintFunctions: unknown[]
  blueprintVariables: unknown[]
  blueprintImports: unknown[]
}

export function isLastStep(intent: {
  step?: number | null
  steps?: unknown[]
}): boolean

export function overlayPatch(
  intent: Record<string, unknown>,
  patchText: string,
  knownFileIds?: string[],
): Record<string, unknown>
