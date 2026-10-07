import type { CodebaseGraph } from './types'

export type FlyToKind = 'file' | 'folder' | 'function' | 'variable'

export const FLY_TO_KINDS: FlyToKind[] = ['file', 'folder', 'function', 'variable']

export type FlyToTarget = { fileId?: string; folderPath?: string }

export type FlyToMatch = FlyToTarget & {
  kind: FlyToKind
  label: string
  detail: string
}

/** Smallest ground span the camera zooms to, so a single file keeps its neighbours in view. */
export const FLY_TO_MIN_SPAN = 40

function stem(name: string) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function isSubsequence(query: string, text: string) {
  let i = 0
  for (const char of text) {
    if (char === query[i]) i += 1
    if (i === query.length) return true
  }
  return false
}

function scoreName(query: string, name: string, path = '') {
  const lower = name.toLowerCase()
  if (lower === query || stem(lower) === query) return 100
  if (lower.startsWith(query)) return 80
  if (lower.includes(query)) return 60
  if (path && path.toLowerCase().includes(query)) return 40
  if (isSubsequence(query, lower)) return 20
  return 0
}

/** Best match for `query` among the graph's items of `kind`, or null when nothing resembles it. */
export function findFlyToMatch(
  graph: CodebaseGraph,
  kind: FlyToKind,
  rawQuery: string,
): FlyToMatch | null {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return null
  let best: { score: number; tiebreak: number; match: FlyToMatch } | null = null
  const consider = (score: number, tiebreak: number, match: FlyToMatch) => {
    if (score <= 0) return
    if (!best || score > best.score || (score === best.score && tiebreak < best.tiebreak)) {
      best = { score, tiebreak, match }
    }
  }

  if (kind === 'file') {
    for (const file of graph.files) {
      consider(scoreName(query, file.name, file.path), file.path.length, {
        kind,
        fileId: file.id,
        label: file.name,
        detail: file.path,
      })
    }
  } else if (kind === 'folder') {
    for (const folder of graph.folders) {
      consider(scoreName(query, folder.name, folder.path), folder.path.length, {
        kind,
        folderPath: folder.path,
        label: folder.name || folder.path,
        detail: folder.path,
      })
    }
  } else {
    for (const file of graph.files) {
      for (const symbol of file.symbols) {
        if (symbol.kind !== kind) continue
        consider(scoreName(query, symbol.name), symbol.name.length * 1000 + file.path.length, {
          kind,
          fileId: file.id,
          label: symbol.name,
          detail: file.path,
        })
      }
    }
  }

  return (best as { match: FlyToMatch } | null)?.match ?? null
}
