import { useEffect } from 'react'
import { NoteForm } from './components/NoteForm'
import { NoteSearch } from './components/NoteSearch'
import { NotesBoard } from './components/NotesBoard'
import { notes } from './store/notes'
import { loadNotes } from './utils/storage'

export function NotesApp() {
  useEffect(() => {
    const stored = loadNotes()
    if (stored.length > 0 && notes.length === 0) {
      notes.push(...stored)
    }
  }, [])

  return (
    <section className="notes-app">
      <NoteForm />
      <NoteSearch />
      <NotesBoard />
    </section>
  )
}
