import type { CodebaseGraph } from './types'

export async function fetchCodebase(): Promise<CodebaseGraph | null> {
  try {
    const response = await fetch(`/api/codebase?t=${Date.now()}`)
    if (!response.ok) return null
    const data = (await response.json()) as CodebaseGraph
    if (!data || !Array.isArray(data.files) || !Array.isArray(data.folders)) {
      return null
    }
    return data
  } catch {
    return null
  }
}
