import type { Note } from '../types'

export function visibleNotes(notes: Note[], query: string): Note[] {
  const needle = query.trim().toLowerCase()
  const matched = needle
    ? notes.filter((note) => note.text.toLowerCase().includes(needle))
    : notes.slice()

  return matched.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.updatedAt - a.updatedAt
  })
}
