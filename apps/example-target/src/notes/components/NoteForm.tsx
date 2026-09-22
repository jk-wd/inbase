import { useState, type FormEvent } from 'react'
import { NOTE_COLORS } from '../constants'
import { addNote } from '../store/notes'
import { ColorPicker } from './ColorPicker'

export function NoteForm() {
  const [text, setText] = useState('')
  const [color, setColor] = useState<string>(NOTE_COLORS[0])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextText = text.trim()
    if (!nextText) return
    addNote(nextText, color)
    setText('')
  }

  return (
    <form className="note-form" onSubmit={handleSubmit}>
      <textarea
        className="note-form-text"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Write a note"
        rows={4}
        aria-label="Note text"
      />
      <div className="note-form-row">
        <ColorPicker value={color} onChange={setColor} />
        <button type="submit">Add note</button>
      </div>
    </form>
  )
}
