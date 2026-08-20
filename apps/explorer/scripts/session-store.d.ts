export type DiffStatus =
  | 'pending'
  | 'extend'
  | 'extended'
  | 'applied'
  | 'rejected'

export type DiffEntry = {
  id: string
  file: string
  parentId: string | null
  step: number
  title: string
  status: DiffStatus
  instruction: string | null
  createdAt: string
  decidedAt: string | null
}

export type DiffManifest = {
  version: number
  sessionId: string
  feature: string
  steps: Array<{ index: number; title: string }>
  status: 'active' | 'finished' | 'rejected'
  phase:
    | 'blueprint_ask'
    | 'blueprint'
    | 'preparing'
    | 'plan_ready'
    | 'working'
    | 'review'
    | 'replanning'
    | 'finished'
    | 'stopped'
  currentStep: number
  activeDiffId: string | null
  pendingInstruction: string | null
  workStartedAt: string | null
  createdAt: string
  updatedAt: string
  diffs: DiffEntry[]
}

export function assertSessionId(value: unknown): string
export function readActiveSession(dataDir: string): string | null
export function writeActiveSession(dataDir: string, sessionId: string | null): void
export function readBlueprintSession(dataDir: string): string | null
export function writeBlueprintSession(dataDir: string, sessionId: string | null): void
export function readManifest(dataDir: string, sessionId: string): DiffManifest | null
export function writeManifest(dataDir: string, manifest: DiffManifest): void
export function startSession(
  dataDir: string,
  input: {
    sessionId: string
    feature?: string
  },
): DiffManifest
export type SessionBlueprint = {
  enabled: boolean
  sent: boolean
  userCreatedBlocks: unknown[]
  userCreatedIslands: unknown[]
  addedFunctions: unknown[]
  addedVariables: unknown[]
  addedImports: unknown[]
}
export function emptyBlueprint(): SessionBlueprint
export function readBlueprint(dataDir: string, sessionId: string): SessionBlueprint
export function writeBlueprint(
  dataDir: string,
  sessionId: string,
  blueprint: SessionBlueprint,
): void
export function answerBlueprint(
  dataDir: string,
  sessionId: string,
  enabled: boolean,
): DiffManifest
export function updateBlueprint(
  dataDir: string,
  sessionId: string,
  input?: {
    userCreatedBlocks?: unknown[]
    userCreatedIslands?: unknown[]
    addedFunctions?: unknown[]
    addedVariables?: unknown[]
    addedImports?: unknown[]
  },
): SessionBlueprint
export function sendBlueprint(
  dataDir: string,
  sessionId: string,
  input?: {
    userCreatedBlocks?: unknown[]
    userCreatedIslands?: unknown[]
    addedFunctions?: unknown[]
    addedVariables?: unknown[]
    addedImports?: unknown[]
  },
): DiffManifest
export function reportPlan(
  dataDir: string,
  input: {
    sessionId: string
    feature: string
    stepTitles: string[]
  },
): DiffManifest
export function invokeStep(
  dataDir: string,
  sessionId: string,
  step: number,
  targetRoot?: string | null,
): DiffManifest
export function sessionIntent(
  dataDir: string,
  sessionId: string,
  knownFileIds?: string[],
  selectedDiffId?: string,
): Record<string, unknown> | null
export function appendDiff(
  dataDir: string,
  targetRoot: string,
  input: {
    sessionId: string
    patchText: string
  },
): { manifest: DiffManifest; entry: DiffEntry }
export function continueDiff(
  dataDir: string,
  targetRoot: string,
  sessionId: string,
  diffId: string,
): DiffManifest
export function requestReplan(
  dataDir: string,
  sessionId: string,
  diffId: string,
  instruction: string,
): DiffManifest
export function stopSession(
  dataDir: string,
  sessionId: string,
  diffId?: string,
): null
export function decideDiff(
  dataDir: string,
  targetRoot: string,
  sessionId: string,
  diffId: string,
  decision: 'approved' | 'extend' | 'rejected',
  instruction?: string,
): DiffManifest | null
export function closeSession(dataDir: string, sessionId: string): void
export function finalizeFinishedSession(dataDir: string, sessionId: string): void
