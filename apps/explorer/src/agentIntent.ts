import type {
  AgentIntent,
  AgentIntentBundle,
  BlueprintNote,
  PatchImport,
  PatchImportAddition,
  PatchSymbolAddition,
  UserCreatedBlock,
  UserCreatedIsland,
  WorkflowAction,
} from './types'
import {
  parseBlueprintNotes,
  parseUserCreatedBlocks,
  parseUserCreatedIslands,
} from './userCreated'

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

function normalizeAck(
  value: unknown,
): AgentIntent['lastAck'] {
  if (!value || typeof value !== 'object') return null
  const kind = (value as { kind?: unknown }).kind
  if (typeof kind !== 'string' || kind.trim() === '') return null
  const detail = (value as { detail?: unknown }).detail
  const at = (value as { at?: unknown }).at
  return {
    kind,
    detail: typeof detail === 'string' ? detail : '',
    at: typeof at === 'string' ? at : null,
  }
}

export const emptyIntent: AgentIntent = {
  updatedAt: null,
  showMap: false,
  status: 'idle',
  name: null,
  feature: null,
  steps: [],
  step: null,
  stepByStep: true,
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
  stalledWait: false,
  llmIdle: false,
  awaitingAttach: false,
  listening: false,
  lastAck: null,
  initialInstruction: null,
  creationMode: false,
  canEnterBlueprint: false,
  blueprintHidden: false,
  blueprintRevision: 0,
  blueprintSessionId: null,
  userCreatedBlocks: [],
  userCreatedIslands: [],
  blueprintFunctions: [],
  blueprintVariables: [],
  blueprintImports: [],
  blueprintNotes: [],
}

function normalize(data: Partial<AgentIntent> | null | undefined): AgentIntent {
  return {
    updatedAt: data?.updatedAt ?? null,
    showMap: Boolean(data?.showMap),
    status: data?.status ?? 'idle',
    name: data?.name ?? null,
    feature: data?.feature ?? null,
    steps: Array.isArray(data?.steps) ? data.steps : [],
    step: typeof data?.step === 'number' ? data.step : null,
    stepByStep: data?.stepByStep !== false,
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
    changedFunctions: normalizeSymbolAdditions(data?.changedFunctions),
    changedVariables: normalizeSymbolAdditions(data?.changedVariables),
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
    stalledWait: Boolean(data?.stalledWait),
    llmIdle: Boolean(data?.llmIdle),
    awaitingAttach: Boolean(data?.awaitingAttach),
    listening: Boolean(data?.listening),
    lastAck: normalizeAck(data?.lastAck),
    initialInstruction:
      typeof data?.initialInstruction === 'string' ? data.initialInstruction : null,
    creationMode: Boolean(data?.creationMode),
    canEnterBlueprint: Boolean(data?.canEnterBlueprint),
    blueprintHidden: Boolean(data?.blueprintHidden),
    blueprintRevision:
      typeof data?.blueprintRevision === 'number' ? data.blueprintRevision : 0,
    blueprintSessionId:
      typeof data?.blueprintSessionId === 'string'
        ? data.blueprintSessionId
        : null,
    userCreatedBlocks: parseUserCreatedBlocks(data?.userCreatedBlocks),
    userCreatedIslands: parseUserCreatedIslands(data?.userCreatedIslands),
    blueprintFunctions: normalizeSymbolAdditions(data?.blueprintFunctions),
    blueprintVariables: normalizeSymbolAdditions(data?.blueprintVariables),
    blueprintImports: normalizeImportAdditions(data?.blueprintImports),
    blueprintNotes: parseBlueprintNotes(data?.blueprintNotes),
  }
}

function normalizeBlueprint(data: Partial<AgentIntentBundle['blueprint']> | null | undefined) {
  return {
    hidden: Boolean(data?.hidden),
    revision: typeof data?.revision === 'number' ? data.revision : 0,
    enabled: Boolean(data?.enabled),
    userCreatedBlocks: parseUserCreatedBlocks(data?.userCreatedBlocks),
    userCreatedIslands: parseUserCreatedIslands(data?.userCreatedIslands),
    addedFunctions: normalizeSymbolAdditions(data?.addedFunctions),
    addedVariables: normalizeSymbolAdditions(data?.addedVariables),
    addedImports: normalizeImportAdditions(data?.addedImports),
    notes: parseBlueprintNotes(data?.notes),
  }
}

export async function fetchAgentIntents(): Promise<AgentIntentBundle> {
  const query = new URLSearchParams({ t: String(Date.now()) })
  const response = await fetch(`/api/agent-intent?${query}`)
  const emptyBlueprint = normalizeBlueprint(null)
  if (!response.ok) {
    return {
      focusedSessionId: null,
      nextAttachSessionId: null,
      intents: [],
      blueprint: emptyBlueprint,
    }
  }
  const data = (await response.json()) as {
    focusedSessionId?: string | null
    nextAttachSessionId?: string | null
    intents?: unknown
    sessionId?: string | null
    blueprint?: Partial<AgentIntentBundle['blueprint']>
  } & Partial<AgentIntent>
  if (Array.isArray(data.intents)) {
    return {
      focusedSessionId:
        typeof data.focusedSessionId === 'string' ? data.focusedSessionId : null,
      nextAttachSessionId:
        typeof data.nextAttachSessionId === 'string'
          ? data.nextAttachSessionId
          : null,
      intents: data.intents
        .map((intent) => normalize(intent as Partial<AgentIntent>))
        .filter((intent) => Boolean(intent.sessionId)),
      blueprint: normalizeBlueprint(data.blueprint),
    }
  }
  const intent = normalize(data)
  return {
    focusedSessionId: intent.sessionId,
    nextAttachSessionId: intent.awaitingAttach ? intent.sessionId : null,
    intents: intent.sessionId ? [intent] : [],
    blueprint: normalizeBlueprint(data.blueprint ?? {
      hidden: intent.blueprintHidden,
      revision: intent.blueprintRevision,
      enabled:
        intent.userCreatedBlocks.length > 0 ||
        intent.userCreatedIslands.length > 0 ||
        intent.blueprintFunctions.length > 0 ||
        intent.blueprintVariables.length > 0 ||
        intent.blueprintImports.length > 0 ||
        intent.blueprintNotes.length > 0,
      userCreatedBlocks: intent.userCreatedBlocks,
      userCreatedIslands: intent.userCreatedIslands,
      addedFunctions: intent.blueprintFunctions,
      addedVariables: intent.blueprintVariables,
      addedImports: intent.blueprintImports,
      notes: intent.blueprintNotes,
    }),
  }
}

export async function fetchAgentIntent(
  sessionId: string,
  diffId?: string,
): Promise<AgentIntent> {
  const query = new URLSearchParams({
    t: String(Date.now()),
    sessionId,
  })
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
    stepByStep?: boolean
    userCreatedBlocks?: UserCreatedBlock[]
    userCreatedIslands?: UserCreatedIsland[]
    addedFunctions?: PatchSymbolAddition[]
    addedVariables?: PatchSymbolAddition[]
    addedImports?: PatchImportAddition[]
    notes?: BlueprintNote[]
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
  sessionId: string | null | undefined,
  payload: {
    userCreatedBlocks: UserCreatedBlock[]
    userCreatedIslands: UserCreatedIsland[]
    addedFunctions?: PatchSymbolAddition[]
    addedVariables?: PatchSymbolAddition[]
    addedImports?: PatchImportAddition[]
    notes?: BlueprintNote[]
  },
) {
  return fetch('/api/agent-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'blueprint_update',
      sessionId,
      ...payload,
    }),
  }).catch(() => {
    // Keep local drafts if the visualizer could not save the shared blueprint.
  })
}

export function persistBlueprintHidden(hidden: boolean) {
  return fetch('/api/agent-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'blueprint_set_hidden',
      hidden,
    }),
  })
}

export function persistBlueprintClear() {
  return fetch('/api/agent-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'blueprint_clear' }),
  })
}

export function persistBlueprintCleanup() {
  return fetch('/api/agent-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'blueprint_cleanup' }),
  })
}

export function persistInitialInstruction(sessionId: string, instruction: string) {
  fetch('/api/agent-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'set_initial_instruction',
      sessionId,
      instruction,
    }),
  }).catch(() => {
    // Keep the local instruction if the session handshake is no longer open.
  })
}

export function persistSessionFocus(sessionId: string) {
  fetch('/api/agent-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'focus',
      sessionId,
    }),
  }).catch(() => {
    // Keep the local focused session if the server could not record it.
  })
}

export async function setupVisualizerSession(name?: string) {
  const response = await fetch('/api/agent-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'setup_session',
      name,
    }),
  })
  if (!response.ok) {
    const detail = await response.text()
    let message = detail || 'Could not set up the LLM session'
    try {
      const parsed = JSON.parse(detail) as { error?: string }
      if (parsed?.error) message = parsed.error
    } catch {
      // Use the raw body when it is not JSON.
    }
    throw new Error(message)
  }
  return normalize((await response.json()) as AgentIntent)
}

export async function inspectTargetFile(payload: {
  sessionId?: string | null
  diffId?: string | null
  fileId?: string
}) {
  const response = await fetch('/api/inspect-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || 'Could not inspect file')
  }
  return (await response.json()) as {
    path: string | null
    uri: string | null
    opened: boolean
  }
}
