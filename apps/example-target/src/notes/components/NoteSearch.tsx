import { useState } from 'react'
import { query, setQuery } from '../store/notes'

export function NoteSearch() {
  const [value, setValue] = useState(query)

  function handleChange(next: string) {
    setValue(next)
    setQuery(next)
  }

  return (
    <label className="note-search">
      <span className="sr-only">Search notes</span>
      <input
        type="search"
        value={value}
        placeholder="Search notes"
        onChange={(event) => handleChange(event.target.value)}
      />
    </label>
  )
}
