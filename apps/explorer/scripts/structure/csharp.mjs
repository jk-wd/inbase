const SKIP_MEMBER = new Set([
  'if',
  'for',
  'foreach',
  'while',
  'switch',
  'catch',
  'using',
  'lock',
  'return',
  'new',
  'get',
  'set',
  'init',
  'add',
  'remove',
  'where',
  'when',
  'class',
  'struct',
  'interface',
  'enum',
  'record',
  'namespace',
  'else',
  'do',
  'try',
  'finally',
  'fixed',
  'checked',
  'unchecked',
  'sizeof',
  'typeof',
  'nameof',
  'default',
  'await',
  'yield',
  'base',
  'this',
  'var',
  'out',
  'ref',
  'in',
  'operator',
  'implicit',
  'explicit',
])

export const id = 'csharp'

export const extensions = new Set(['.cs'])

export function stripCSharpTrivia(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, (match) => ' '.repeat(match.length))
    .replace(/@"(?:""|[^"])*"/g, (match) => ' '.repeat(match.length))
    .replace(/"(?:\\.|[^"\\\n])*"/g, (match) => ' '.repeat(match.length))
}

function classSpans(source) {
  const spans = []
  const pattern = /(?:^|[^\w])class\s+([A-Za-z_]\w*)/g
  for (const match of source.matchAll(pattern)) {
    const name = match[1]
    const brace = source.indexOf('{', match.index + match[0].length)
    if (brace < 0) continue
    let depth = 0
    let end = -1
    for (let index = brace; index < source.length; index += 1) {
      const char = source[index]
      if (char === '{') depth += 1
      else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          end = index
          break
        }
      }
    }
    if (end < 0) continue
    spans.push({ name, bodyStart: brace + 1, bodyEnd: end })
  }
  return spans
}

function directMemberChunks(body) {
  const chunks = []
  let depth = 0
  let start = 0
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (char === '{') {
      if (depth === 0) chunks.push(body.slice(start, index))
      depth += 1
    } else if (char === '}') {
      depth = Math.max(0, depth - 1)
      if (depth === 0) start = index + 1
    } else if (char === ';' && depth === 0) {
      chunks.push(body.slice(start, index))
      start = index + 1
    }
  }
  if (depth === 0 && start < body.length) chunks.push(body.slice(start))
  return chunks
}

function memberFromChunk(chunk) {
  const cleaned = chunk.replace(/\[[^\]]*\]/g, ' ').trim()
  if (!cleaned) return null
  if (/\b(?:class|struct|interface|enum|record|namespace)\b/.test(cleaned)) return null
  if (/\boperator\b/.test(cleaned)) return null
  const eq = cleaned.indexOf('=')
  const paren = cleaned.indexOf('(')
  const isMethod = paren >= 0 && (eq < 0 || paren < eq)
  const source = isMethod
    ? cleaned.slice(0, paren)
    : eq >= 0
      ? cleaned.slice(0, eq)
      : cleaned
  const names = source.match(/[A-Za-z_]\w*/g)
  if (!names) return null
  const name = names[names.length - 1]
  if (!name || SKIP_MEMBER.has(name)) return null
  return { name, kind: isMethod ? 'function' : 'variable' }
}

export function extractSymbols(source) {
  const stripped = stripCSharpTrivia(source)
  const symbols = []
  const seen = new Set()
  const add = (name, kind, className = '') => {
    if (!name) return
    const key = `${kind}\0${className}\0${name}`
    if (seen.has(key)) return
    seen.add(key)
    const symbol = { name, kind }
    if (className) symbol.class = className
    symbols.push(symbol)
  }

  for (const span of classSpans(stripped)) {
    add(span.name, 'class')
    const body = stripped.slice(span.bodyStart, span.bodyEnd)
    for (const chunk of directMemberChunks(body)) {
      const member = memberFromChunk(chunk)
      if (!member) continue
      add(member.name, member.kind, span.name)
    }
  }

  return symbols
}
