import { useState } from 'react'
import type { Note } from '../types'
import { ColorPicker } from './ColorPicker'
import { updateNote, removeNote, togglePin } from '../store/notes'

type NoteCardProps = {
  note: Note
}

export function NoteCard({ note }: NoteCardProps) {
  const [text, setText] = useState(note.text)
  const [color, setColor] = useState(note.color)
  const [pinned, setPinned] = useState(note.pinned)

  function handleTextChange(next: string) {
    setText(next)
    updateNote(note.id, { text: next })
  }

  function handleColorChange(next: string) {
    setColor(next)
    updateNote(note.id, { color: next })
  }

  function handleTogglePin() {
    setPinned((current) => !current)
    togglePin(note.id)
  }

  return (
    <article className="note-card" style={{ backgroundColor: color }}>
      <textarea
        className="note-card-text"
        value={text}
        onChange={(event) => handleTextChange(event.target.value)}
        aria-label="Note text"
      />
      <div className="note-card-footer">
        <ColorPicker value={color} onChange={handleColorChange} />
        <div className="note-card-actions">
          <button
            type="button"
            aria-pressed={pinned}
            onClick={handleTogglePin}
          >
            {pinned ? 'Unpin' : 'Pin'}
          </button>
          <button type="button" onClick={() => removeNote(note.id)}>
            Delete
          </button>
        </div>
      </div>
    </article>
  )
}
