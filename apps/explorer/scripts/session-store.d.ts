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
  name: string
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
  awaitingAttach?: boolean
  currentStep: number
  activeDiffId: string | null
  pendingInstruction: string | null
  initialInstruction?: string | null
  workStartedAt: string | null
  stepByStep: boolean
  createdAt: string
  updatedAt: string
  diffs: DiffEntry[]
}

export function assertSessionId(value: unknown): string
export function readActiveSession(dataDir: string): string | null
export function writeActiveSession(dataDir: string, sessionId: string | null): void
export function focusSession(dataDir: string, sessionId: string): string
export function sessionPaths(
  dataDir: string,
  sessionId: string,
): {
  root: string
  diffs: string
  manifest: string
  blueprint: string
  baseline: string
  baselineFiles: string
  preStep: string
  stopped: string
}
export function touchSessionConnection(dataDir: string, sessionId: string): void
export function recordSessionAck(
  dataDir: string,
  sessionId: string,
  kind: string,
  detail?: string,
): { kind: string; detail: string; at: string } | null
export function isSessionConnected(
  dataDir: string,
  sessionId: string,
  waiterIds?: Set<string>,
): boolean
export function listStoredSessionIds(dataDir: string): string[]
export function listOpenSessionIds(
  dataDir: string,
  waiterIds?: Set<string>,
): string[]
export function discardInactiveDiffSessions(
  dataDir: string,
  targetRoot?: string | null,
  waiterIds?: Iterable<string>,
): string[]
export function recoverOpenDiffSessions(
  dataDir: string,
  targetRoot?: string | null,
): string[]
export function clearDiffSessions(
  dataDir: string,
  targetRoot?: string | null,
): void
export function listSessionIntents(
  dataDir: string,
  knownFileIds?: string[],
): Array<Record<string, unknown>>
export function readBlueprintSession(dataDir: string): string | null
export function writeBlueprintSession(dataDir: string, sessionId: string | null): void
export function readManifest(dataDir: string, sessionId: string): DiffManifest | null
export function writeManifest(dataDir: string, manifest: DiffManifest): void
export function isSessionStopped(dataDir: string, sessionId: string): boolean
export function isWorkflowStopped(dataDir: string, sessionId: string): boolean
export function sessionStoppedError(sessionId: string): Error
export function startSession(
  dataDir: string,
  input: {
    sessionId: string
    name?: string
    feature?: string
  },
): DiffManifest
export function setupSession(
  dataDir: string,
  input?: {
    sessionId?: string
    name?: string
    feature?: string
  },
): DiffManifest
export function attachSession(
  dataDir: string,
  sessionId?: string | null,
): DiffManifest
export function setInitialInstruction(
  dataDir: string,
  sessionId: string,
  instruction: string | null | undefined,
): DiffManifest
export function readAttachedSession(dataDir: string): string | null
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
export function maybeStartVisualizerHandshake(
  dataDir: string,
  sessionId: string,
): DiffManifest
export function reportPlan(
  dataDir: string,
  input: {
    sessionId: string
    name?: string
    feature: string
    stepTitles: string[]
    targetRoot?: string | null
  },
): DiffManifest
export function isStepByStep(manifest: DiffManifest | null | undefined): boolean
export function autoAdvance(
  dataDir: string,
  sessionId: string,
  targetRoot?: string | null,
): DiffManifest | null
export function setStepByStep(
  dataDir: string,
  sessionId: string,
  enabled: boolean,
  targetRoot?: string | null,
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
  waiterIds?: Set<string>,
): Record<string, unknown> | null
export function resolveTargetFile(
  targetRoot: string,
  fileId: string,
): { id: string; absolute: string }
export function captureBaseline(
  dataDir: string,
  sessionId: string,
  targetRoot: string,
  fileIds?: string[],
): { files: Record<string, { existed: boolean }> }
export function restoreBaseline(
  dataDir: string,
  sessionId: string,
  targetRoot: string,
): void
export function materializeDiff(
  dataDir: string,
  targetRoot: string,
  sessionId: string,
  diffId?: string | null,
): DiffManifest
export function snapshotPreStep(
  dataDir: string,
  sessionId: string,
  targetRoot: string,
): string
export function readLiveDiff(
  dataDir: string,
  sessionId: string,
  targetRoot: string,
): string
export function inspectTargetFile(
  dataDir: string,
  targetRoot: string,
  input?: {
    sessionId?: string | null
    diffId?: string | null
    fileId?: string | null
  },
): string | null
export function appendDiff(
  dataDir: string,
  targetRoot: string,
  input: {
    sessionId: string
    patchText?: string
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
  targetRoot?: string | null,
): DiffManifest
export function stopSession(
  dataDir: string,
  sessionId: string,
  targetRoot?: string | null,
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
