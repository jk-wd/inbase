const STEP_ID_PREFIX =
  /^(\d+[A-Za-z]?(?:\.\d+[A-Za-z]?)*)[.:)\-]\s+(.+)$/

export function normalizeStepId(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed.replace(/[a-z]/g, (ch) => ch.toUpperCase())
}

export function stepIdOf(step) {
  if (!step || typeof step !== 'object') return ''
  const labeled = normalizeStepId(step.id)
  if (labeled) return labeled
  return Number.isInteger(step.index) ? String(step.index) : ''
}

export function parseStepTitle(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (!trimmed) return { id: null, title: '' }
  const match = trimmed.match(STEP_ID_PREFIX)
  if (!match) return { id: null, title: trimmed }
  const title = match[2].trim()
  if (!title) return { id: null, title: trimmed }
  return { id: normalizeStepId(match[1]), title }
}

export function parseStepIdParts(id) {
  const normalized = normalizeStepId(id)
  if (!normalized) return []
  return normalized.split('.').map((token) => {
    const match = token.match(/^(\d+)([A-Z]?)$/)
    if (!match) return { n: 0, letter: '' }
    return { n: Number(match[1]), letter: match[2] || '' }
  })
}

export function compareStepIds(left, right) {
  const a = parseStepIdParts(left)
  const b = parseStepIdParts(right)
  const len = Math.max(a.length, b.length)
  for (let index = 0; index < len; index += 1) {
    const partA = a[index]
    const partB = b[index]
    if (!partA) return -1
    if (!partB) return 1
    if (partA.n !== partB.n) return partA.n - partB.n
    if (partA.letter !== partB.letter) {
      return partA.letter.localeCompare(partB.letter)
    }
  }
  return 0
}

export function waveNumber(id) {
  return parseStepIdParts(id)[0]?.n ?? 0
}

function formatStepParts(parts) {
  return parts
    .map((part) => `${part.n}${part.letter || ''}`)
    .join('.')
}

export function parentStepIds(id, allIds) {
  const ids = allIds instanceof Set ? allIds : new Set(allIds)
  const parts = parseStepIdParts(id)
  if (parts.length === 0) return []

  if (parts.length > 1) {
    const parent = formatStepParts(parts.slice(0, -1))
    if (ids.has(parent)) return [parent]
    return parentStepIds(parent, ids)
  }

  const [{ n, letter }] = parts
  if (letter) {
    const unlettered = String(n)
    if (ids.has(unlettered)) return [unlettered]
  }
  if (n <= 1) return []
  return [...ids].filter((item) => waveNumber(item) === n - 1)
}

export function readyStepIds(steps, completedIds, currentIds) {
  const list = Array.isArray(steps) ? steps : []
  const completed = completedIds instanceof Set ? completedIds : new Set(completedIds)
  const current = currentIds instanceof Set ? currentIds : new Set(currentIds)
  const allIds = new Set(list.map((step) => stepIdOf(step)).filter(Boolean))
  const ready = []
  for (const step of list) {
    const id = stepIdOf(step)
    if (!id || completed.has(id) || current.has(id)) continue
    const parents = parentStepIds(id, allIds)
    if (parents.every((parent) => completed.has(parent))) ready.push(id)
  }
  return ready.sort(compareStepIds)
}

export function nextInvokedStepIds(
  steps,
  completedIds,
  currentIds,
  maxSubagents = 4,
) {
  const current = [...(currentIds instanceof Set ? currentIds : currentIds ?? [])]
  const cap =
    Number.isInteger(maxSubagents) && maxSubagents > 0 ? maxSubagents : 1
  const slots = Math.max(0, cap - current.length)
  if (slots === 0) return current
  const ready = readyStepIds(steps, completedIds, current)
  return [...current, ...ready.slice(0, slots)]
}

export function planLabeledSteps(titles, startAt = 1, delivery = null) {
  if (!Array.isArray(titles) || titles.length === 0) {
    throw new Error('A plan needs at least one step')
  }
  const parsed = titles.map((title) => {
    const item = parseStepTitle(title)
    if (!item.title) throw new Error('Plan step titles cannot be empty')
    return item
  })
  const hasExplicit = parsed.some((item) => item.id)
  const used = new Set()
  const steps = []
  let auto = startAt

  for (const item of parsed) {
    let id = item.id
    if (!hasExplicit) {
      id = String(startAt + steps.length)
    } else if (!id) {
      while (used.has(String(auto))) auto += 1
      id = String(auto)
      auto += 1
    }
    if (used.has(id)) {
      throw new Error(`Duplicate plan step id ${id}`)
    }
    used.add(id)
    const step = {
      index: startAt + steps.length,
      id,
      title: item.title,
    }
    if (delivery) step.delivery = delivery
    steps.push(step)
  }
  return steps
}
