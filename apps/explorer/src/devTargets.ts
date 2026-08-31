import { parseCodebase } from './codebase'
import type { CodebaseGraph } from './types'

export type DevTargetOption = {
  id: string
  label: string
}

export type DevTargetsState = {
  enabled: boolean
  currentId: string | null
  targets: DevTargetOption[]
}

export const emptyDevTargets: DevTargetsState = {
  enabled: false,
  currentId: null,
  targets: [],
}

function parseState(data: unknown): DevTargetsState {
  if (!data || typeof data !== 'object') return emptyDevTargets
  const record = data as DevTargetsState
  if (!record.enabled || !Array.isArray(record.targets)) return emptyDevTargets
  return {
    enabled: true,
    currentId: typeof record.currentId === 'string' ? record.currentId : null,
    targets: record.targets.filter(
      (item): item is DevTargetOption =>
        Boolean(item) &&
        typeof item.id === 'string' &&
        typeof item.label === 'string',
    ),
  }
}

export async function fetchDevTargets(): Promise<DevTargetsState> {
  try {
    const response = await fetch('/api/dev-targets')
    if (!response.ok) return emptyDevTargets
    return parseState(await response.json())
  } catch {
    return emptyDevTargets
  }
}

export async function selectDevTarget(id: string): Promise<{
  state: DevTargetsState
  graph: CodebaseGraph | null
} | null> {
  try {
    const response = await fetch('/api/dev-targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (!response.ok) return null
    const payload = (await response.json()) as { codebase?: unknown }
    return {
      state: parseState(payload),
      graph: parseCodebase(payload.codebase),
    }
  } catch {
    return null
  }
}
