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
}

export type FolderNode = {
  path: string
  name: string
  parent: string | null
  files: string[]
  children: string[]
  userCreated?: boolean
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

export type FlyTo = {
  nonce: number
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
}

export type UserCreatedIsland = {
  id: string
  name: string
  path: string
  parent: string
  naming?: boolean
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
  followLook?: boolean
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

export function canStopSession(intent: {
  sessionId: string | null
  status: AgentIntentStatus
}) {
  return Boolean(intent.sessionId) && intent.status !== 'idle'
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
  | 'instruct'
  | 'stop'
  | 'blueprint_yes'
  | 'blueprint_no'
  | 'blueprint_send'
  | 'blueprint_update'

export type AgentIntentBundle = {
  focusedSessionId: string | null
  intents: AgentIntent[]
}

export type AgentIntent = {
  updatedAt: string | null
  showMap: boolean
  status: AgentIntentStatus
  feature: string | null
  steps: PlanStep[]
  step: number | null
  files: string[]
  creates: string[]
  deletes: string[]
  createFolders: string[]
  createLines: Record<string, number>
  imports: PatchImport[]
  addedFunctions: PatchSymbolAddition[]
  addedVariables: PatchSymbolAddition[]
  addedImports: PatchImportAddition[]
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
  creationMode: boolean
  canEnterBlueprint: boolean
  blueprintSessionId: string | null
  userCreatedBlocks: UserCreatedBlock[]
  userCreatedIslands: UserCreatedIsland[]
  blueprintFunctions: PatchSymbolAddition[]
  blueprintVariables: PatchSymbolAddition[]
  blueprintImports: PatchImportAddition[]
}
