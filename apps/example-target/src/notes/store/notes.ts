import { createNote } from '../types'
import type { Note } from '../types'
import { nextId } from '../utils/ids'
import { loadNotes, saveNotes } from '../utils/storage'

export let notes: Note[] = loadNotes()
export let query = ''

function persist(): void {
  saveNotes(notes)
}

export function addNote(text: string, color: string): Note {
  const note = createNote(text, color, nextId())
  notes = [note, ...notes]
  persist()
  return note
}

export function updateNote(
  id: string,
  patch: { text?: string; color?: string },
): void {
  notes = notes.map((note) =>
    note.id === id
      ? { ...note, ...patch, updatedAt: Date.now() }
      : note,
  )
  persist()
}

export function removeNote(id: string): void {
  notes = notes.filter((note) => note.id !== id)
  persist()
}

export function togglePin(id: string): void {
  notes = notes.map((note) =>
    note.id === id
      ? { ...note, pinned: !note.pinned, updatedAt: Date.now() }
      : note,
  )
  persist()
}

export function setQuery(text: string): void {
  query = text
}
