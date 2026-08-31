import type {
  CodebaseGraph,
  FileNode,
  UserContext,
  UserFileRef,
} from './types'

export function toFileRef(file: FileNode): UserFileRef {
  return {
    id: file.id,
    name: file.name,
    path: file.path,
    folder: file.folder,
  }
}

let timer: number | null = null
let pending: UserContext | null = null
let lastWritten = ''

export async function fetchUserContext(): Promise<UserContext | null> {
  try {
    const response = await fetch('/api/user-context')
    if (!response.ok) return null
    return (await response.json()) as UserContext
  } catch {
    return null
  }
}

export function persistShowBranchChanges(showBranchChanges: boolean) {
  fetch('/api/user-context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: `${JSON.stringify({ showBranchChanges })}\n`,
  }).catch(() => {
    lastWritten = ''
  })
}

export function persistUserContext(context: UserContext) {
  pending = context
  if (timer !== null) return
  timer = window.setTimeout(flushUserContext, 400)
}

function flushUserContext() {
  timer = null
  const context = pending
  pending = null
  if (!context) return
  const {
    showBranchChanges: _showBranchChanges,
    userCreatedBlocks: _userCreatedBlocks,
    userCreatedIslands: _userCreatedIslands,
    ...gaze
  } = context
  const body = JSON.stringify(gaze, null, 2)
  if (body === lastWritten) return
  lastWritten = body
  fetch('/api/user-context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: `${body}\n`,
  }).catch(() => {
    lastWritten = ''
  })
}

export function fileById(graph: CodebaseGraph, id: string | null) {
  if (!id) return null
  return graph.files.find((file) => file.id === id) ?? null
}
