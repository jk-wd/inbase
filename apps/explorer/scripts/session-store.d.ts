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

export type SessionContextFile = {
  id: string
  name: string
  storedName: string
  mimeType: string
  size: number
}

export type SessionContextFileInfo = {
  id: string
  name: string
  mimeType: string
  size: number
  path?: string
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
  color?: string
  currentStep: number
  activeDiffId: string | null
  pendingInstruction: string | null
  pendingExplain?: boolean
  initialInstruction?: string | null
  contextFiles?: SessionContextFile[]
  workStartedAt: string | null
  stepByStep: boolean
  createdAt: string
  updatedAt: string
  diffs: DiffEntry[]
  blueprintRevision?: number
  localBlueprintRevision?: number
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
  context: string
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
export function recycleDisconnectedSessions(
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
    focus?: boolean
  },
): DiffManifest
export function attachSession(
  dataDir: string,
  sessionId?: string | null,
  options?: { color?: string | null },
): DiffManifest
export function setInitialInstruction(
  dataDir: string,
  sessionId: string,
  instruction: string | null | undefined,
): DiffManifest
export const MAX_CONTEXT_FILES: number
export const MAX_CONTEXT_FILE_BYTES: number
export const MAX_CONTEXT_TOTAL_BYTES: number
export const SESSION_SLOT_COUNT: number
export const DEFAULT_STEP_BY_STEP: boolean
export const SESSION_COLORS: Array<{ id: string; name: string; hex: string }>
export const SESSION_COLOR_ALIASES: Record<string, string>
export const GLOBAL_BLUEPRINT_COLOR: { id: 'global'; name: 'Global'; hex: string }
export function resolveSessionColor(
  colorId: string | null | undefined,
): { id: string; name: string; hex: string } | null
export function parseSessionColorQuery(
  value: string | null | undefined,
): { id: string; name: string; hex: string } | null
export function colorUnknownMessage(query?: string | null): string
export function colorBusyMessage(colorName: string): string
export function colorMissingMessage(colorName: string): string
export function isGlobalBlueprintColor(colorId: string | null | undefined): boolean
export function findSessionIdByColor(
  dataDir: string,
  colorId: string | null | undefined,
): string | null
export const CHAT_LIMIT_MESSAGE: string
export const NOT_RUNNING_MESSAGE: string
export function enableSessionPool(dataDir: string, count?: number): void
export function sessionPoolSize(dataDir: string): number
export function ensureSessionPool(
  dataDir: string,
  options?: { count?: number; focus?: boolean },
): DiffManifest[]
export function listContextFiles(
  dataDir: string,
  sessionId: string,
): Array<SessionContextFile & { path: string }>
export function contextFileHandshake(
  dataDir: string,
  sessionId: string,
): {
  files: Array<{ name: string; path: string; mimeType: string; size: number }>
  texts: Array<{ name: string; content: string }>
}
export function addContextFiles(
  dataDir: string,
  sessionId: string,
  files: unknown,
): DiffManifest
export function removeContextFile(
  dataDir: string,
  sessionId: string,
  fileId: string,
): DiffManifest
export function readAttachedSession(dataDir: string): string | null
export function listAttachQueue(dataDir: string): string[]
export function nextAttachSessionId(dataDir: string): string | null
export type SessionBlueprint = {
  hidden: boolean
  revision: number
  enabled: boolean
  sent: boolean
  userCreatedBlocks: unknown[]
  userCreatedIslands: unknown[]
  addedFunctions: unknown[]
  addedVariables: unknown[]
  addedImports: unknown[]
  notes: unknown[]
  pointers: unknown[]
}
export function emptyBlueprint(): SessionBlueprint
export function readBlueprint(dataDir: string, sessionId?: string): SessionBlueprint
export function readLocalBlueprint(dataDir: string, sessionId?: string | null): SessionBlueprint
export function readBlueprintByColor(
  dataDir: string,
  colorId?: string | null,
): SessionBlueprint
export type LocalBlueprint = SessionBlueprint & {
  color: string
  colorName: string
  colorHex: string
  sessionId: string
}
export function listLocalBlueprints(dataDir: string): LocalBlueprint[]
export function writeBlueprint(
  dataDir: string,
  blueprint: SessionBlueprint,
): SessionBlueprint
export function writeBlueprint(
  dataDir: string,
  sessionId: string,
  blueprint: SessionBlueprint,
): SessionBlueprint
export function writeLocalBlueprint(
  dataDir: string,
  sessionId: string,
  blueprint: Partial<SessionBlueprint>,
): SessionBlueprint
export function writeBlueprintByColor(
  dataDir: string,
  colorId: string | null | undefined,
  blueprint: Partial<SessionBlueprint>,
): SessionBlueprint
export function setBlueprintHidden(
  dataDir: string,
  hidden: boolean,
  colorId?: string | null,
): SessionBlueprint
export function clearBlueprint(
  dataDir: string,
  colorId?: string | null,
): SessionBlueprint
export function cleanupBlueprint(
  dataDir: string,
  knownFileIds?: string[],
  knownFolderPaths?: string[],
  colorId?: string | null,
): SessionBlueprint
export function markBlueprintSeen(
  dataDir: string,
  sessionId: string,
  revision: number,
  localRevision?: number,
): DiffManifest | null
export function answerBlueprint(
  dataDir: string,
  sessionId: string,
  enabled: boolean,
): DiffManifest
export function updateBlueprint(
  dataDir: string,
  sessionId?: string | null,
  input?: {
    color?: string | null
    userCreatedBlocks?: unknown[]
    userCreatedIslands?: unknown[]
    addedFunctions?: unknown[]
    addedVariables?: unknown[]
    addedImports?: unknown[]
    notes?: unknown[]
    pointers?: unknown[]
  },
): SessionBlueprint
export function sendBlueprint(
  dataDir: string,
  sessionId: string,
  input?: unknown,
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
    stepByStep?: boolean
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
export function notifySessionExplain(
  dataDir: string,
  sessionId: string,
  detail?: string,
): DiffManifest | null
export function requestExplainProposal(
  dataDir: string,
  sessionId: string,
  diffId?: string | null,
): DiffManifest
export function consumeExplainRequest(
  dataDir: string,
  sessionId: string,
): DiffManifest | null
export function clearPendingExplain(
  dataDir: string,
  sessionId?: string | null,
): DiffManifest | null
export function touchExplainConnections(dataDir: string): void
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
  decision: 'approved' | 'rejected',
): DiffManifest | null
export function closeSession(dataDir: string, sessionId: string): void
export function finalizeFinishedSession(dataDir: string, sessionId: string): void
