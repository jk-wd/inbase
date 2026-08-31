import fs from 'node:fs'
import path from 'node:path'

export const EXPLAIN_FILE = 'explain.json'

function atomicWrite(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, contents)
  fs.renameSync(temporary, file)
}

function explainPath(dataDir) {
  return path.join(dataDir, EXPLAIN_FILE)
}

function splitList(value) {
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseRelation(value) {
  if (typeof value !== 'string') return null
  const index = value.lastIndexOf(':')
  if (index <= 0 || index === value.length - 1) return null
  const from = value.slice(0, index).trim()
  const to = value.slice(index + 1).trim()
  if (!from || !to) return null
  return { from, to }
}

function uniqueStrings(values) {
  const seen = new Set()
  const items = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const next = value.trim()
    if (!next || seen.has(next)) continue
    seen.add(next)
    items.push(next)
  }
  return items
}

function uniqueRelations(values) {
  const seen = new Set()
  const items = []
  for (const value of values) {
    const edge =
      value && typeof value === 'object'
        ? {
            from: typeof value.from === 'string' ? value.from.trim() : '',
            to: typeof value.to === 'string' ? value.to.trim() : '',
          }
        : parseRelation(value)
    if (!edge?.from || !edge?.to) continue
    const key = `${edge.from}->${edge.to}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push(edge)
  }
  return items
}

export function isExplainStepId(value) {
  return typeof value === 'string' && /^\d+(?:\.\d+)*$/.test(value)
}

export function explainStepId(value, fallback = '') {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return String(value)
  }
  if (typeof value === 'string') {
    const next = value.trim()
    if (isExplainStepId(next)) return next
  }
  return fallback
}

export function isExplainDescendant(id, parent) {
  const child = explainStepId(id, '')
  const root = explainStepId(parent, '')
  return Boolean(child && root && child.startsWith(`${root}.`))
}

export function topLevelExplainStepId(id) {
  const next = explainStepId(id, '')
  const dot = next.indexOf('.')
  return dot === -1 ? next : next.slice(0, dot)
}

export function isExplainSubStep(id) {
  return explainStepId(id, '').includes('.')
}

export function stripExplainSubSteps(steps) {
  return (Array.isArray(steps) ? steps : [])
    .filter((step) => !isExplainSubStep(step?.index))
    .map((step) => ({ ...step, asked: '' }))
}

function parseSymbolKind(value) {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (key === 'function' || key === 'fn') return 'function'
  if (key === 'variable' || key === 'var') return 'variable'
  if (key === 'class') return 'class'
  if (key === 'file') return 'file'
  if (key === 'symbol') return 'symbol'
  return null
}

export function parseExplainSymbolRef(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.toLowerCase() === 'file') return { kind: 'file', name: '' }
  const index = trimmed.indexOf(':')
  if (index > 0) {
    const kind = parseSymbolKind(trimmed.slice(0, index))
    const name = trimmed.slice(index + 1).trim()
    if (kind === 'file') return { kind: 'file', name }
    if (kind && name) return { kind, name }
  }
  return { kind: 'symbol', name: trimmed }
}

function uniqueSymbolRefs(values) {
  const seen = new Set()
  const items = []
  for (const value of values) {
    const ref =
      value && typeof value === 'object'
        ? parseExplainSymbolRef(
            `${typeof value.kind === 'string' ? value.kind : 'symbol'}:${typeof value.name === 'string' ? value.name : ''}`,
          ) ??
          (typeof value.name === 'string' ? parseExplainSymbolRef(value.name) : null)
        : parseExplainSymbolRef(value)
    if (!ref) continue
    const key = `${ref.kind}:${ref.name}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push(ref)
  }
  return items
}

function emptyStep(title, index) {
  return {
    index: explainStepId(index, '1'),
    title: typeof title === 'string' ? title.trim() : '',
    body: '',
    asked: '',
    files: [],
    folders: [],
    select: null,
    zoom: null,
    relations: [],
    importedBy: false,
    info: false,
    highlights: [],
    point: null,
  }
}

export function emptyExplain() {
  return {
    active: false,
    question: '',
    steps: [],
    currentStep: '1',
    pendingQuestion: null,
    pendingStart: null,
    answering: false,
    presentation: 'walk',
    updatedAt: null,
  }
}

export function normalizeExplainPresentation(value) {
  return value === 'card' ? 'card' : 'walk'
}

const EXPLAIN_TARGET_KINDS = new Set([
  'file',
  'folder',
  'function',
  'variable',
  'class',
])

export function parseExplainTargetKind(value) {
  return typeof value === 'string' && EXPLAIN_TARGET_KINDS.has(value)
    ? value
    : null
}

export function explainTargetLabel({ kind, path, name }) {
  const noun = parseExplainTargetKind(kind) ?? 'file'
  const target = typeof path === 'string' ? path.trim() : ''
  const symbol = typeof name === 'string' ? name.trim() : ''
  return symbol ? `${noun} ${symbol} in ${target}` : `${noun} ${target}`
}

export function explainTargetQuestion(kind, path, name) {
  return `Explain the function of the ${explainTargetLabel({ kind, path, name })} and where it fits in the codebase.`
}

function normalizePendingStart(value) {
  if (!value || typeof value !== 'object') return null
  const kind = parseExplainTargetKind(value.kind)
  const path = typeof value.path === 'string' ? value.path.trim() : ''
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  const question = typeof value.question === 'string' ? value.question.trim() : ''
  if (!kind || !path || !question) return null
  if ((kind === 'function' || kind === 'variable' || kind === 'class') && !name) {
    return null
  }
  return name ? { kind, path, name, question } : { kind, path, question }
}

function normalizePendingQuestion(value) {
  if (!value || typeof value !== 'object') return null
  const parent = explainStepId(value.parent ?? value.step, '')
  const question =
    typeof value.question === 'string' ? value.question.trim() : ''
  if (!parent || !question) return null
  const from = explainStepId(value.from, parent)
  const fromTitle =
    typeof value.fromTitle === 'string' ? value.fromTitle.trim() : ''
  return {
    parent,
    question,
    from: from || parent,
    fromTitle,
  }
}

function normalizeStep(value, index) {
  const assigned = explainStepId(
    value && typeof value === 'object' ? (value.index ?? value.id) : index,
    explainStepId(index, '1'),
  )
  const fallback = emptyStep('', assigned)
  if (!value || typeof value !== 'object') return fallback
  const title =
    typeof value.title === 'string' && value.title.trim()
      ? value.title.trim()
      : `Step ${assigned}`
  const select =
    typeof value.select === 'string' && value.select.trim()
      ? value.select.trim()
      : null
  const zoom =
    typeof value.zoom === 'string' && value.zoom.trim()
      ? value.zoom.trim()
      : null
  const asked =
    typeof value.asked === 'string'
      ? value.asked.trim()
      : typeof value.question === 'string' && value.question.trim()
        ? value.question.trim()
        : ''
  const files = uniqueStrings(Array.isArray(value.files) ? value.files : [])
  const highlights = uniqueSymbolRefs(
    Array.isArray(value.highlights) ? value.highlights : [],
  )
  const point = value.point
    ? parseExplainSymbolRef(
        typeof value.point === 'string'
          ? value.point
          : `${typeof value.point.kind === 'string' ? value.point.kind : 'symbol'}:${typeof value.point.name === 'string' ? value.point.name : ''}`,
      )
    : null
  const info = Boolean(value.info) || highlights.length > 0 || Boolean(point)
  let nextSelect = select
  if (info && !nextSelect && files[0]) nextSelect = files[0]
  if (info && nextSelect && !files.includes(nextSelect)) files.unshift(nextSelect)
  return {
    index: assigned,
    title,
    body: typeof value.body === 'string' ? value.body.trim() : '',
    asked,
    files,
    folders: uniqueStrings(Array.isArray(value.folders) ? value.folders : []),
    select: nextSelect,
    zoom,
    relations: uniqueRelations(Array.isArray(value.relations) ? value.relations : []),
    importedBy: Boolean(value.importedBy),
    info,
    highlights,
    point,
  }
}

function assignStepIndexes(steps, parent = '') {
  const prefix = parent ? `${parent}.` : ''
  return steps.map((step, index) =>
    normalizeStep({ ...step, index: `${prefix}${index + 1}`, asked: parent ? '' : step.asked }, index + 1),
  )
}

export function normalizeExplain(value) {
  const empty = emptyExplain()
  if (!value || typeof value !== 'object') return empty
  const steps = Array.isArray(value.steps)
    ? value.steps.map((step, index) => normalizeStep(step, index + 1))
    : []
  const ids = new Set(steps.map((step) => step.index))
  const current = explainStepId(
    value.currentStep,
    steps[0]?.index ?? empty.currentStep,
  )
  const pendingQuestion = normalizePendingQuestion(value.pendingQuestion)
  return {
    active: Boolean(value.active),
    question: typeof value.question === 'string' ? value.question.trim() : '',
    steps,
    currentStep: ids.has(current) ? current : (steps[0]?.index ?? empty.currentStep),
    pendingQuestion:
      pendingQuestion && ids.has(pendingQuestion.parent) ? pendingQuestion : null,
    pendingStart: normalizePendingStart(value.pendingStart),
    answering: Boolean(value.answering),
    presentation: normalizeExplainPresentation(value.presentation),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
  }
}

export function readExplain(dataDir) {
  try {
    return normalizeExplain(
      JSON.parse(fs.readFileSync(explainPath(dataDir), 'utf8')),
    )
  } catch {
    return emptyExplain()
  }
}

function writeExplain(dataDir, value) {
  const next = {
    ...normalizeExplain(value),
    updatedAt: new Date().toISOString(),
  }
  atomicWrite(explainPath(dataDir), `${JSON.stringify(next, null, 2)}\n`)
  return next
}

export function startExplain(dataDir, question) {
  const title = typeof question === 'string' ? question.trim() : ''
  if (!title) {
    throw new Error('question is required')
  }
  const previous = readExplain(dataDir)
  const continuingCard =
    previous.presentation === 'card' &&
    previous.active &&
    (Boolean(previous.pendingStart) || previous.question === title)
  return writeExplain(dataDir, {
    active: true,
    question: title,
    steps: [],
    currentStep: '1',
    pendingQuestion: null,
    pendingStart: null,
    answering: false,
    presentation: continuingCard ? 'card' : 'walk',
  })
}

export function requestExplainTarget(dataDir, input) {
  const kind = parseExplainTargetKind(input?.kind)
  const target = typeof input?.path === 'string' ? input.path.trim() : ''
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (!kind) {
    throw new Error('kind must be file, folder, function, variable, or class')
  }
  if (!target) {
    throw new Error('path is required')
  }
  if ((kind === 'function' || kind === 'variable' || kind === 'class') && !name) {
    throw new Error('name is required')
  }
  const question =
    typeof input?.question === 'string' && input.question.trim()
      ? input.question.trim()
      : explainTargetQuestion(kind, target, name)
  return writeExplain(dataDir, {
    active: true,
    question,
    steps: [],
    currentStep: '1',
    pendingQuestion: null,
    pendingStart: name
      ? { kind, path: target, name, question }
      : { kind, path: target, question },
    answering: false,
    presentation: 'card',
  })
}

export function consumeExplainStart(dataDir) {
  const current = readExplain(dataDir)
  const pending = current.pendingStart
  if (!pending) return null
  writeExplain(dataDir, {
    ...current,
    pendingStart: null,
  })
  return pending
}

function reportExplainChildren(dataDir, parent, input) {
  const current = readExplain(dataDir)
  const parentId = topLevelExplainStepId(parent)
  const roots = stripExplainSubSteps(current.steps)
  const parentIndex = roots.findIndex((step) => step.index === parentId)
  if (!current.active || parentIndex < 0) {
    throw new Error(`unknown parent step ${parentId || parent}`)
  }
  const raw = Array.isArray(input?.steps) ? input.steps : []
  if (raw.length === 0) {
    throw new Error('at least one --step is required')
  }
  const asked =
    typeof input?.question === 'string' && input.question.trim()
      ? input.question.trim()
      : current.pendingQuestion?.parent === parentId
        ? current.pendingQuestion.question
        : ''
  const children = assignStepIndexes(raw, parentId)
  const parentStep = {
    ...roots[parentIndex],
    asked,
  }
  const steps = [
    ...roots.slice(0, parentIndex),
    parentStep,
    ...children,
    ...roots.slice(parentIndex + 1),
  ]
  return writeExplain(dataDir, {
    ...current,
    steps,
    currentStep: children[0].index,
    pendingQuestion: null,
    answering: false,
  })
}

export function reportExplain(dataDir, input) {
  const question =
    typeof input?.question === 'string' ? input.question.trim() : ''
  const steps = Array.isArray(input?.steps) ? input.steps : []
  if (steps.length === 0) {
    throw new Error('at least one --step is required')
  }
  const parent = explainStepId(input?.parent, '')
  if (parent) {
    return reportExplainChildren(dataDir, parent, input)
  }
  const previous = readExplain(dataDir)
  return writeExplain(dataDir, {
    active: true,
    question: question || previous.question,
    steps: assignStepIndexes(steps),
    currentStep: '1',
    pendingQuestion: null,
    answering: false,
    presentation: previous.presentation === 'card' ? 'card' : 'walk',
  })
}

export function setExplainStep(dataDir, step) {
  const current = readExplain(dataDir)
  if (!current.active) return current
  const next = explainStepId(step, '')
  if (!current.steps.some((item) => item.index === next)) return current
  return writeExplain(dataDir, {
    ...current,
    currentStep: next,
  })
}

export function askExplainQuestion(dataDir, step, question) {
  const current = readExplain(dataDir)
  if (!current.active) {
    throw new Error('explain mode is not active')
  }
  const clicked = explainStepId(step, '')
  const clickedStep = current.steps.find((item) => item.index === clicked)
  const text = typeof question === 'string' ? question.trim() : ''
  if (!text) {
    throw new Error('question is required')
  }
  if (!clickedStep) {
    throw new Error(`unknown step ${clicked || step}`)
  }
  const parent = topLevelExplainStepId(clicked)
  if (!current.steps.some((item) => item.index === parent)) {
    throw new Error(`unknown step ${parent || step}`)
  }
  return writeExplain(dataDir, {
    ...current,
    steps: stripExplainSubSteps(current.steps),
    currentStep: parent,
    pendingQuestion: {
      parent,
      question: text,
      from: clicked,
      fromTitle: clickedStep.title,
    },
    answering: false,
  })
}

export function consumeExplainQuestion(dataDir) {
  const current = readExplain(dataDir)
  const pending = current.pendingQuestion
  if (!pending || current.answering) return null
  writeExplain(dataDir, {
    ...current,
    pendingQuestion: pending,
    answering: true,
  })
  return pending
}

export function stopExplain(dataDir) {
  return writeExplain(dataDir, emptyExplain())
}

export function parseExplainArgs(args) {
  const steps = []
  let current = null
  let question = ''
  let parent = ''

  const requireCurrent = () => {
    if (current) return current
    current = emptyStep('Explanation', steps.length + 1)
    steps.push(current)
    return current
  }

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    const value = args[index + 1]
    if (flag === '--imported-by') {
      requireCurrent().importedBy = true
      continue
    }
    if (flag === '--info') {
      const step = requireCurrent()
      step.info = true
      if (typeof value === 'string' && value && !value.startsWith('--')) {
        const file = value.trim()
        if (file) {
          step.files = uniqueStrings([...step.files, file])
          if (!step.select) step.select = file
        }
        index += 1
      }
      continue
    }
    if (typeof value !== 'string') continue
    if (flag === '--question') {
      question = value.trim()
      index += 1
      continue
    }
    if (flag === '--parent') {
      parent = value.trim()
      index += 1
      continue
    }
    if (flag === '--step') {
      current = emptyStep(value, steps.length + 1)
      steps.push(current)
      index += 1
      continue
    }
    if (flag === '--body') {
      requireCurrent().body = value.trim()
      index += 1
      continue
    }
    if (flag === '--files') {
      const step = requireCurrent()
      step.files = uniqueStrings([...step.files, ...splitList(value)])
      index += 1
      continue
    }
    if (flag === '--folders') {
      const step = requireCurrent()
      step.folders = uniqueStrings([...step.folders, ...splitList(value)])
      index += 1
      continue
    }
    if (flag === '--select') {
      requireCurrent().select = value.trim() || null
      index += 1
      continue
    }
    if (flag === '--zoom') {
      requireCurrent().zoom = value.trim() || null
      index += 1
      continue
    }
    if (flag === '--relations') {
      const step = requireCurrent()
      const extra = splitList(value)
        .map(parseRelation)
        .filter(Boolean)
      step.relations = uniqueRelations([...step.relations, ...extra])
      index += 1
      continue
    }
    if (flag === '--highlight') {
      const step = requireCurrent()
      const extra = splitList(value)
        .map(parseExplainSymbolRef)
        .filter(Boolean)
      step.highlights = uniqueSymbolRefs([...step.highlights, ...extra])
      index += 1
      continue
    }
    if (flag === '--point') {
      requireCurrent().point = parseExplainSymbolRef(value)
      index += 1
    }
  }

  return {
    question,
    parent: explainStepId(parent, ''),
    steps: steps
      .filter((step) => step.title)
      .map((step, index) => normalizeStep(step, index + 1)),
  }
}

export function parseExplainCli(args) {
  const raw = Array.isArray(args) ? args : []
  const sub =
    raw[0] === 'start' ||
    raw[0] === 'report' ||
    raw[0] === 'stop' ||
    raw[0] === 'wait'
      ? raw[0]
      : null
  const rest = sub ? raw.slice(1) : raw
  if (sub === 'stop') return { action: 'stop' }
  if (sub === 'wait') return { action: 'wait' }
  const parsed = parseExplainArgs(rest)
  if (sub === 'start' || (parsed.question && parsed.steps.length === 0 && !sub)) {
    return { action: 'start', question: parsed.question }
  }
  return {
    action: 'report',
    question: parsed.question,
    parent: parsed.parent,
    steps: parsed.steps,
  }
}
