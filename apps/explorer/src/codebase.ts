import type { CodebaseGraph } from './types'

export function parseCodebase(data: unknown): CodebaseGraph | null {
  if (
    !data ||
    typeof data !== 'object' ||
    !Array.isArray((data as CodebaseGraph).files) ||
    !Array.isArray((data as CodebaseGraph).folders)
  ) {
    return null
  }
  return data as CodebaseGraph
}

export async function fetchCodebase(): Promise<CodebaseGraph | null> {
  try {
    const response = await fetch(`/api/codebase?t=${Date.now()}`)
    if (!response.ok) return null
    return parseCodebase(await response.json())
  } catch {
    return null
  }
}

export async function updateCodebase(): Promise<CodebaseGraph | null> {
  try {
    const response = await fetch('/api/codebase', { method: 'POST' })
    if (!response.ok) return null
    return parseCodebase(await response.json())
  } catch {
    return null
  }
}
