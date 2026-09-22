import { notes, query } from '../store/notes'
import { visibleNotes } from '../utils/query'
import { EmptyState } from './EmptyState'
import { NoteCard } from './NoteCard'

export function NotesBoard() {
  const shown = visibleNotes(notes, query)

  if (shown.length === 0) {
    return <EmptyState query={query} />
  }

  return (
    <div className="notes-board">
      {shown.map((note) => (
        <NoteCard key={note.id} note={note} />
      ))}
    </div>
  )
}
