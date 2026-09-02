export type SymbolKind = 'function' | 'variable' | 'class'

export type CodeSymbol = {
  name: string
  kind: SymbolKind
  intended?: boolean
}

export type FileNode = {
  id: string
  name: string
  path: string
  folder: string
  lines: number
  language: string
  symbols: CodeSymbol[]
  imports: string[]
  userCreated?: boolean
  colorHex?: string
}

export type FolderNode = {
  path: string
  name: string
  parent: string | null
  files: string[]
  children: string[]
  userCreated?: boolean
  colorHex?: string
}

export type CodebaseGraph = {
  root: string
  targetName: string
  files: FileNode[]
  folders: FolderNode[]
}

export type PlacedFile = {
  id: string
  position: [number, number, number]
  size: [number, number, number]
  aisleFace: 1 | -1
}

export type PlacedFolder = {
  path: string
  name: string
  x: number
  z: number
  width: number
  depth: number
  added?: boolean
  overlay?: boolean
  userCreated?: boolean
  colorHex?: string
}

export type PlacedBridge = {
  id: string
  label: string
  fromLabel: string
  points: [number, number][]
}

export type WorldLayout = {
  files: Record<string, PlacedFile>
  folders: Record<string, PlacedFolder>
  bridges: PlacedBridge[]
  spawn: [number, number, number]
}

export type ViewMode = 'map' | 'walk'

export type RelationMode = 'all' | 'off' | 'changed' | 'targeted'

export type FlyTo = {
  nonce: number
  from: [number, number]
  lookAt: [number, number, number]
}

export type UserFileRef = {
  id: string
  name: string
  path: string
  folder: string
}

export type UserCreatedBlock = {
  id: string
  name: string
  path: string
  folder: string
  x: number
  z: number
  naming?: boolean
  colorHex?: string
}

export type UserCreatedIsland = {
  id: string
  name: string
  path: string
  parent: string
  naming?: boolean
  colorHex?: string
}

export type UserContext = {
  updatedAt: string | null
  mode: ViewMode
  island: {
    path: string | null
    name: string
  }
  lookingAt: UserFileRef | null
  lookingAtFiles: UserFileRef[]
  selected: UserFileRef | null
  filesOnIsland: UserFileRef[]
  position: {
    x: number
    z: number
  }
  showBranchChanges?: boolean
  userCreatedBlocks?: UserCreatedBlock[]
  userCreatedIslands?: UserCreatedIsland[]
}

export type AgentIntentStatus =
  | 'idle'
  | 'blueprint_ask'
  | 'blueprint'
  | 'preparing'
  | 'planned'
  | 'working'
  | 'replanning'
  | 'pending'
  | 'approved'
  | 'extend'
  | 'extended'
  | 'finished'
  | 'rejected'

export function isPatchPreview(status: AgentIntentStatus) {
  return status === 'pending' || status === 'extend' || status === 'extended'
}

export function isReviewingIntent(status: AgentIntentStatus) {
  return (
    status === 'blueprint_ask' ||
    status === 'blueprint' ||
    status === 'preparing' ||
    status === 'planned' ||
    status === 'working' ||
    status === 'replanning' ||
    status === 'pending' ||
    status === 'approved' ||
    status === 'extend' ||
    status === 'extended' ||
    status === 'finished'
  )
}

export function llmIsMakingChanges(intent: {
  working: boolean
  preview: boolean
  status: AgentIntentStatus
}) {
  return (
    intent.working ||
    intent.preview ||
    intent.status === 'preparing' ||
    intent.status === 'working' ||
    intent.status === 'replanning' ||
    intent.status === 'pending' ||
    intent.status === 'extend' ||
    intent.status === 'extended'
  )
}

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

export type PlanStep = {
  index: number
  title: string
}

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

export type BlueprintNoteKind = 'file' | 'function' | 'variable'

export type BlueprintNote = {
  file: string
  kind: BlueprintNoteKind
  name?: string
  note: string
}

export type BlueprintPointerKind = 'file' | 'folder' | 'function' | 'variable'

export type BlueprintPointer = {
  kind: BlueprintPointerKind
  path: string
  name?: string
}

export type AimedRelation = {
  from: string
  to: string
  flyTo: string
}

export type DiffChainEntry = {
  id: string
  index: number
  step: number
  title: string
  status: 'pending' | 'extend' | 'extended' | 'applied' | 'rejected'
}

export type WorkflowPhase =
  | 'blueprint_ask'
  | 'blueprint'
  | 'preparing'
  | 'plan_ready'
  | 'working'
  | 'review'
  | 'replanning'
  | 'finished'
  | 'stopped'

export type WorkflowAction =
  | 'invoke'
  | 'continue'
  | 'explain_proposal'
  | 'stop'
  | 'blueprint_yes'
  | 'blueprint_no'
  | 'blueprint_send'
  | 'blueprint_update'
  | 'blueprint_clear'
  | 'blueprint_cleanup'
  | 'blueprint_set_hidden'
  | 'focus'
  | 'set_step_by_step'

export type SharedBlueprint = {
  hidden: boolean
  revision: number
  enabled: boolean
  userCreatedBlocks: UserCreatedBlock[]
  userCreatedIslands: UserCreatedIsland[]
  addedFunctions: PatchSymbolAddition[]
  addedVariables: PatchSymbolAddition[]
  addedImports: PatchImportAddition[]
  notes: BlueprintNote[]
  pointers: BlueprintPointer[]
}

export const GLOBAL_BLUEPRINT_COLOR = {
  id: 'global',
  name: 'Global',
  hex: '#38bdf8',
} as const

export const SESSION_COLOR_ORDER = [
  'coral',
  'amber',
  'lime',
  'orange',
  'violet',
] as const

export function sessionColorOrderIndex(colorId?: string | null) {
  if (!colorId) return SESSION_COLOR_ORDER.length
  const index = SESSION_COLOR_ORDER.indexOf(
    colorId as (typeof SESSION_COLOR_ORDER)[number],
  )
  return index === -1 ? SESSION_COLOR_ORDER.length : index
}

export function compareSessionColorOrder(
  left?: string | null,
  right?: string | null,
) {
  return sessionColorOrderIndex(left) - sessionColorOrderIndex(right)
}

export type BlueprintColorId = typeof GLOBAL_BLUEPRINT_COLOR.id | string

export type LocalBlueprint = SharedBlueprint & {
  color: string
  colorName: string
  colorHex: string
  sessionId: string
}

export type BlueprintOption = {
  id: string
  name: string
  hex: string
  kind: 'global' | 'local'
  sessionId?: string | null
}

export type AgentIntentBundle = {
  focusedSessionId: string | null
  nextAttachSessionId: string | null
  intents: AgentIntent[]
  blueprint: SharedBlueprint
  localBlueprints: LocalBlueprint[]
}

export type ExplainRelation = {
  from: string
  to: string
}

export type ExplainSymbolKind = 'function' | 'variable' | 'class' | 'file' | 'symbol'

export type ExplainSymbolRef = {
  kind: ExplainSymbolKind
  name: string
}

export type ExplainPendingQuestion = {
  parent: string
  question: string
  from: string
  fromTitle: string
}

export type ExplainTargetKind =
  | 'file'
  | 'folder'
  | 'function'
  | 'variable'
  | 'class'

export type ExplainPendingStart = {
  kind: ExplainTargetKind
  path: string
  name?: string
  question: string
}

export type ExplainStep = {
  index: string
  title: string
  body: string
  asked: string
  files: string[]
  folders: string[]
  select: string | null
  zoom: string | null
  relations: ExplainRelation[]
  importedBy: boolean
  info: boolean
  highlights: ExplainSymbolRef[]
  point: ExplainSymbolRef | null
}

export type ExplainPresentation = 'walk' | 'card'

export type ExplainSession = {
  active: boolean
  question: string
  steps: ExplainStep[]
  currentStep: string
  pendingQuestion: ExplainPendingQuestion | null
  pendingStart: ExplainPendingStart | null
  answering: boolean
  presentation: ExplainPresentation
  updatedAt: string | null
}

export type AgentIntent = {
  updatedAt: string | null
  showMap: boolean
  status: AgentIntentStatus
  name: string | null
  color?: string | null
  colorName?: string | null
  colorHex?: string | null
  feature: string | null
  steps: PlanStep[]
  step: number | null
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
  reason: string | null
  sessionId: string | null
  diffId: string | null
  parentDiffId: string | null
  chainIndex: number | null
  chain: DiffChainEntry[]
  isActiveDiff: boolean
  preview: boolean
  phase: WorkflowPhase | null
  working: boolean
  stalledWait: boolean
  llmIdle?: boolean
  awaitingAttach?: boolean
  listening?: boolean
  lastAck?: {
    kind: string
    detail: string
    at: string | null
  } | null
  pendingExplain?: boolean
  explainActive?: boolean
  initialInstruction?: string | null
  contextFiles?: Array<{
    id: string
    name: string
    mimeType: string
    size: number
  }>
  creationMode: boolean
  canEnterBlueprint: boolean
  blueprintHidden?: boolean
  blueprintRevision?: number
  blueprintSessionId: string | null
  localBlueprintEnabled?: boolean
  userCreatedBlocks: UserCreatedBlock[]
  userCreatedIslands: UserCreatedIsland[]
  blueprintFunctions: PatchSymbolAddition[]
  blueprintVariables: PatchSymbolAddition[]
  blueprintImports: PatchImportAddition[]
  blueprintNotes: BlueprintNote[]
  blueprintPointers: BlueprintPointer[]
}
