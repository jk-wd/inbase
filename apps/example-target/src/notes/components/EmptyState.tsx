type EmptyStateProps = {
  query?: string
}

export function EmptyState({ query }: EmptyStateProps) {
  const searching = Boolean(query?.trim())

  return (
    <p className="notes-empty">
      {searching
        ? `No notes match “${query?.trim()}”.`
        : 'No notes yet. Add one to fill the board.'}
    </p>
  )
}
