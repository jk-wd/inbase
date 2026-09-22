let count = 0

export function nextId(): string {
  count += 1
  return `note-${Date.now().toString(36)}-${count.toString(36)}`
}
