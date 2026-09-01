export function destructuredNames(pattern, { importClause = false } = {}) {
  const names = []
  const inner = pattern.slice(1, -1)
  for (const part of inner.split(',')) {
    let token = part.trim()
    if (!token) continue
    token = token.replace(/^\.\.\./, '')
    if (importClause) {
      const aliased = token.match(/^(?:type\s+)?[A-Za-z_$][\w$]*\s+as\s+([A-Za-z_$][\w$]*)$/)
      if (aliased) {
        names.push(aliased[1])
        continue
      }
      const ident = token.replace(/^type\s+/, '').trim()
      if (/^[A-Za-z_$][\w$]*$/.test(ident)) names.push(ident)
      continue
    }
    const aliased = token.match(/^[A-Za-z_$][\w$]*\s*:\s*([A-Za-z_$][\w$]*)/)
    if (aliased) {
      names.push(aliased[1])
      continue
    }
    const ident = token.split(/\s*=/)[0].trim()
    if (/^[A-Za-z_$][\w$]*$/.test(ident)) names.push(ident)
  }
  return names
}
