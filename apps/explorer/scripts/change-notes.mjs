/** Browser-safe LLM change-note helpers. Do not import Node modules here. */

export function overlayFileIds(overlay) {
  return [
    ...new Set([
      ...(overlay?.files ?? []),
      ...(overlay?.creates ?? []),
      ...(overlay?.deletes ?? []),
    ]),
  ]
}

export function asChangeNotes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([path, note]) => {
      if (typeof path !== 'string' || !path.trim()) return []
      if (typeof note !== 'string' || !note.trim()) return []
      return [[path.trim(), note.trim()]]
    }),
  )
}

export function parseChangeNoteFlag(value) {
  if (typeof value !== 'string') return null
  const match = value.match(/^([^:]+):\s*(.+)$/)
  if (!match) return null
  const path = match[1].trim()
  const note = match[2].trim()
  if (!path || !note) return null
  return { path, note }
}

export function parseChangeNoteFlags(values) {
  const notes = {}
  for (const value of values ?? []) {
    const parsed = parseChangeNoteFlag(value)
    if (parsed) notes[parsed.path] = parsed.note
  }
  return notes
}

export function pathIsUnderFolder(fileId, folderPath) {
  if (!folderPath || folderPath === '.') return true
  return fileId === folderPath || fileId.startsWith(`${folderPath}/`)
}

export function changeNotePathRelevant(overlay, path) {
  if (!path) return false
  if ((overlay?.createFolders ?? []).includes(path)) return true
  return overlayFileIds(overlay).some((id) => id === path || pathIsUnderFolder(id, path))
}

function fileChangeKind(overlay, fileId) {
  if ((overlay.deletes ?? []).includes(fileId)) return 'remove'
  if ((overlay.creates ?? []).includes(fileId)) return 'add'
  if ((overlay.files ?? []).includes(fileId)) return 'edit'
  return null
}

export function overlayPathChangeKind(overlay, path, folder = false) {
  if (!folder) return fileChangeKind(overlay, path)
  const kinds = []
  if ((overlay.createFolders ?? []).includes(path)) kinds.push('add')
  for (const id of overlayFileIds(overlay)) {
    if (!pathIsUnderFolder(id, path)) continue
    const kind = fileChangeKind(overlay, id)
    if (kind) kinds.push(kind)
  }
  if (kinds.includes('add')) return 'add'
  if (kinds.includes('edit')) return 'edit'
  if (kinds.includes('remove')) return 'remove'
  return null
}

function symbolsForFile(overlay, fileId) {
  const names = []
  const seen = new Set()
  const add = (list) => {
    for (const item of list ?? []) {
      if (item.file !== fileId || seen.has(item.name)) continue
      seen.add(item.name)
      names.push(item.name)
    }
  }
  add(overlay.changedFunctions)
  add(overlay.addedFunctions)
  if (names.length === 0) {
    add(overlay.changedVariables)
    add(overlay.addedVariables)
  }
  return names.slice(0, 3)
}

function joinGoal(action, reason) {
  const goal = typeof reason === 'string' ? reason.trim() : ''
  if (!goal) return action
  if (action.toLowerCase().includes(goal.toLowerCase())) return action
  return `${action} — ${goal}`
}

export function synthesizeFileNote(overlay, fileId, reason) {
  const kind = fileChangeKind(overlay, fileId)
  const listed = symbolsForFile(overlay, fileId).join(', ')
  if (kind === 'remove') return joinGoal('removed this file', reason)
  if (kind === 'add') {
    return joinGoal(listed ? `added ${listed}` : 'added this file', reason)
  }
  if (kind === 'edit') {
    return joinGoal(listed ? `edited ${listed}` : 'updated this file', reason)
  }
  return typeof reason === 'string' ? reason.trim() : ''
}

export function synthesizeFolderNote(overlay, folderPath, reason) {
  const ids = overlayFileIds(overlay).filter((id) =>
    pathIsUnderFolder(id, folderPath),
  )
  if (ids.length === 1) return synthesizeFileNote(overlay, ids[0], reason)
  const added = ids.filter((id) => (overlay.creates ?? []).includes(id)).length
  const deleted = ids.filter((id) => (overlay.deletes ?? []).includes(id)).length
  const edited = ids.length - added - deleted
  const parts = []
  if (edited) parts.push(`edited ${edited} ${edited === 1 ? 'file' : 'files'}`)
  if (added) parts.push(`added ${added}`)
  if (deleted) parts.push(`deleted ${deleted}`)
  const action = parts.join(', ') || 'updated this folder'
  return joinGoal(action, reason)
}

export function llmChangeNoteForPath(overlay, path, options = {}) {
  const folder = Boolean(options.folder)
  const reason = options.reason ?? ''
  const stored = overlay?.changeNotes?.[path]
  if (typeof stored === 'string' && stored.trim()) return stored.trim()
  if (folder) {
    const ids = overlayFileIds(overlay).filter((id) => pathIsUnderFolder(id, path))
    if (ids.length === 1) {
      const fileNote = overlay?.changeNotes?.[ids[0]]
      if (typeof fileNote === 'string' && fileNote.trim()) return fileNote.trim()
    }
    return synthesizeFolderNote(overlay, path, reason)
  }
  return synthesizeFileNote(overlay, path, reason)
}

export function formatLlmChangeLine({ kind, colorName, note }) {
  const verb =
    kind === 'add' ? 'I added:' : kind === 'remove' ? 'I deleted:' : 'I changed:'
  const session = colorName ? `(${colorName})` : ''
  const body = typeof note === 'string' ? note.trim() : ''
  return [verb, session, body].filter(Boolean).join(' ')
}
