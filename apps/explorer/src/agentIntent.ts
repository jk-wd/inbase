import type {
  AgentIntent,
  PatchImport,
  PatchImportAddition,
  PatchSymbolAddition,
  UserCreatedBlock,
  UserCreatedIsland,
  WorkflowAction,
} from './types'
import { parseUserCreatedBlocks, parseUserCreatedIslands } from './userCreated'

function normalizeImports(value: unknown): PatchImport[] {
  if (!Array.isArray(value)) return []
  return value.filter((edge): edge is PatchImport => {
    if (!edge || typeof edge !== 'object') return false
    const from = (edge as PatchImport).from
    const to = (edge as PatchImport).to
    return typeof from === 'string' && typeof to === 'string'
  })
}

function normalizeSymbolAdditions(value: unknown): PatchSymbolAddition[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is PatchSymbolAddition => {
    if (!item || typeof item !== 'object') return false
    const name = (item as PatchSymbolAddition).name
    const file = (item as PatchSymbolAddition).file
    return typeof name === 'string' && typeof file === 'string'
  })
}

function normalizeImportAdditions(value: unknown): PatchImportAddition[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is PatchImportAddition => {
    if (!item || typeof item !== 'object') return false
    const name = (item as PatchImportAddition).name
    const from = (item as PatchImportAddition).from
    const file = (item as PatchImportAddition).file
    return (
      typeof name === 'string' &&
      typeof from === 'string' &&
      typeof file === 'string'
    )
  })
}

export const emptyIntent: AgentIntent = {
  updatedAt: null,
  showMap: false,
  status: 'idle',
  feature: null,
  steps: [],
  step: null,
  files: [],
  creates: [],
  deletes: [],
  createFolders: [],
  createLines: {},
  imports: [],
  addedFunctions: [],
  addedVariables: [],
  addedImports: [],
  reason: null,
  sessionId: null,
  diffId: null,
  parentDiffId: null,
  chainIndex: null,
  chain: [],
  isActiveDiff: false,
  preview: false,
  phase: null,
  working: false,
  creationMode: false,
  canEnterBlueprint: false,
  blueprintSessionId: null,
  userCreatedBlocks: [],
  userCreatedIslands: [],
  blueprintFunctions: [],
  blueprintVariables: [],
  blueprintImports: [],
}

function normalize(data: Partial<AgentIntent> | null | undefined): AgentIntent {
  return {
    updatedAt: data?.updatedAt ?? null,
    showMap: Boolean(data?.showMap),
    status: data?.status ?? 'idle',
    feature: data?.feature ?? null,
    steps: Array.isArray(data?.steps) ? data.steps : [],
    step: typeof data?.step === 'number' ? data.step : null,
    files: Array.isArray(data?.files) ? data.files : [],
    creates: Array.isArray(data?.creates) ? data.creates : [],
    deletes: Array.isArray(data?.deletes) ? data.deletes : [],
    createFolders: Array.isArray(data?.createFolders) ? data.createFolders : [],
    createLines:
      data?.createLines && typeof data.createLines === 'object'
        ? data.createLines
        : {},
    imports: normalizeImports(data?.imports),
    addedFunctions: normalizeSymbolAdditions(data?.addedFunctions),
    addedVariables: normalizeSymbolAdditions(data?.addedVariables),
    addedImports: normalizeImportAdditions(data?.addedImports),
    reason: data?.reason ?? null,
    sessionId: data?.sessionId ?? null,
    diffId: data?.diffId ?? null,
    parentDiffId: data?.parentDiffId ?? null,
    chainIndex: typeof data?.chainIndex === 'number' ? data.chainIndex : null,
    chain: Array.isArray(data?.chain) ? data.chain : [],
    isActiveDiff: Boolean(data?.isActiveDiff),
    preview: Boolean(data?.preview),
    phase: data?.phase ?? null,
    working: Boolean(data?.working),
    creationMode: Boolean(data?.creationMode),
    canEnterBlueprint: Boolean(data?.canEnterBlueprint),
    blueprintSessionId:
      typeof data?.blueprintSessionId === 'string'
        ? data.blueprintSessionId
        : null,
    userCreatedBlocks: parseUserCreatedBlocks(data?.userCreatedBlocks),
    userCreatedIslands: parseUserCreatedIslands(data?.userCreatedIslands),
    blueprintFunctions: normalizeSymbolAdditions(data?.blueprintFunctions),
    blueprintVariables: normalizeSymbolAdditions(data?.blueprintVariables),
    blueprintImports: normalizeImportAdditions(data?.blueprintImports),
  }
}

export async function fetchAgentIntent(diffId?: string): Promise<AgentIntent> {
  const query = new URLSearchParams({ t: String(Date.now()) })
  if (diffId) query.set('diffId', diffId)
  const response = await fetch(`/api/agent-intent?${query}`)
  if (!response.ok) return emptyIntent
  return normalize((await response.json()) as AgentIntent)
}

export async function performAgentAction(
  action: WorkflowAction,
  sessionId: string,
  options: {
    diffId?: string
    instruction?: string
    step?: number
    userCreatedBlocks?: UserCreatedBlock[]
    userCreatedIslands?: UserCreatedIsland[]
    addedFunctions?: PatchSymbolAddition[]
    addedVariables?: PatchSymbolAddition[]
    addedImports?: PatchImportAddition[]
  } = {},
) {
  const response = await fetch('/api/agent-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, sessionId, ...options }),
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Could not record visualizer decision')
  }
  return normalize((await response.json()) as AgentIntent)
}

export function persistSessionBlueprint(
  sessionId: string,
  payload: {
    userCreatedBlocks: UserCreatedBlock[]
    userCreatedIslands: UserCreatedIsland[]
    addedFunctions?: PatchSymbolAddition[]
    addedVariables?: PatchSymbolAddition[]
    addedImports?: PatchImportAddition[]
  },
) {
  fetch('/api/agent-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'blueprint_update',
      sessionId,
      ...payload,
    }),
  }).catch(() => {
    // Keep local drafts if the session handshake is no longer open.
  })
}
