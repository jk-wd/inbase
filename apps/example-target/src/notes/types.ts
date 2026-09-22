export type Note = {
  id: string
  text: string
  color: string
  pinned: boolean
  updatedAt: number
}

export function createNote(text: string, color: string, id: string): Note {
  return {
    id,
    text,
    color,
    pinned: false,
    updatedAt: Date.now(),
  }
}
