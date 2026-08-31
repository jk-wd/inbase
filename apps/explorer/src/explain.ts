import { folderOfFile } from './layout'
import type {
  CodebaseGraph,
  ExplainSession,
  ExplainStep,
  ExplainSymbolRef,
  ExplainTargetKind,
  FileNode,
  PatchImport,
} from './types'

export function emptyExplain(): ExplainSession {
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

function explainStepIds(steps: ExplainStep[]) {
  return new Set(steps.map((step) => step.index))
}

export function mergeExplainPoll(
  current: ExplainSession,
  next: ExplainSession,
): ExplainSession {
  if (!current.active || !next.active) return next
  if (current.question !== next.question) return next
  if (current.presentation !== next.presentation) return next

  const currentIds = explainStepIds(current.steps)
  const nextIds = explainStepIds(next.steps)
  const added = [...nextIds].filter((id) => !currentIds.has(id))
  if (current.steps.length === 0 && next.steps.length > 0) return next
  if (added.includes(next.currentStep)) return next

  const pendingUnacked =
    Boolean(current.pendingQuestion) &&
    !next.pendingQuestion &&
    !next.answering
  const steps = pendingUnacked ? current.steps : next.steps
  const pendingQuestion = pendingUnacked
    ? current.pendingQuestion
    : next.pendingQuestion
  const validIds = explainStepIds(steps)
  const currentStep = validIds.has(current.currentStep)
    ? current.currentStep
    : next.currentStep

  return {
    ...next,
    steps,
    pendingQuestion,
    currentStep,
  }
}

export function explainIsCard(explain: ExplainSession) {
  return explain.active && explain.presentation === 'card'
}

export async function fetchExplain(): Promise<ExplainSession> {
  try {
    const query = new URLSearchParams({ t: String(Date.now()) })
    const response = await fetch(`/api/explain?${query}`)
    if (!response.ok) return emptyExplain()
    return (await response.json()) as ExplainSession
  } catch {
    return emptyExplain()
  }
}

export function persistExplainStep(step: string) {
  return fetch('/api/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set_step', step }),
  }).catch(() => {
    // Keep the local step if the visualizer could not save it.
  })
}

export function persistExplainAsk(step: string, question: string) {
  return fetch('/api/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'ask', step, question }),
  }).catch(() => {
    // Keep the local question if the visualizer could not save it.
  })
}

export function persistExplainStop() {
  return fetch('/api/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'stop' }),
  }).catch(() => {
    // Keep the local overlay if the visualizer could not stop.
  })
}

export function explainTargetLabel(input: {
  kind: ExplainTargetKind
  path: string
  name?: string
}) {
  const symbol = input.name?.trim() ?? ''
  return symbol
    ? `${input.kind} ${symbol} in ${input.path}`
    : `${input.kind} ${input.path}`
}

export function explainTargetQuestion(
  kind: ExplainTargetKind,
  path: string,
  name?: string,
) {
  return `Explain the function of the ${explainTargetLabel({ kind, path, name })} and where it fits in the codebase.`
}

export function persistExplainStart(input: {
  kind: ExplainTargetKind
  path: string
  name?: string
  sessionId?: string | null
}) {
  return fetch('/api/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'start', ...input }),
  }).catch(() => {
    // Keep the local overlay if the visualizer could not start.
  })
}

export function currentExplainStep(explain: ExplainSession): ExplainStep | null {
  if (!explain.active || explain.steps.length === 0) return null
  return (
    explain.steps.find((step) => step.index === explain.currentStep) ??
    explain.steps[0] ??
    null
  )
}

export function explainStepPosition(explain: ExplainSession, id: string) {
  return explain.steps.findIndex((step) => step.index === id)
}

export function explainNeighbor(
  explain: ExplainSession,
  id: string,
  delta: number,
) {
  const position = explainStepPosition(explain, id)
  if (position < 0) return null
  return explain.steps[position + delta]?.index ?? null
}

export function explainStepDepth(id: string) {
  return String(id).split('.').length - 1
}

export function topLevelExplainStepId(id: string) {
  const next = String(id)
  const dot = next.indexOf('.')
  return dot === -1 ? next : next.slice(0, dot)
}

export function stripExplainSubSteps(steps: ExplainStep[]): ExplainStep[] {
  return steps
    .filter((step) => !step.index.includes('.'))
    .map((step) => ({ ...step, asked: '' }))
}

export function explainIsPreparing(explain: ExplainSession) {
  if (!explain.active) return false
  if (explain.steps.length === 0) return true
  return Boolean(explain.pendingQuestion) || explain.answering
}

export function explainSpeechText(step: Pick<ExplainStep, 'title' | 'body'> | null) {
  if (!step) return ''
  return [step.title, step.body]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('. ')
}

export function explainCardCopy(explain: ExplainSession) {
  const first =
    explain.steps.find((step) => !step.index.includes('.') && step.body.trim()) ??
    explain.steps.find((step) => !step.index.includes('.')) ??
    null
  const pending = explain.pendingStart
  const title = pending
    ? pending.name?.trim() || pending.path.split('/').pop() || pending.path
    : first?.title.trim() || 'Explanation'
  return {
    title,
    body: first?.body.trim() ?? '',
    ready: Boolean(first?.body.trim()),
  }
}

export function explainSymbolKey(ref: ExplainSymbolRef) {
  return `${ref.kind}:${ref.name}`
}

export function explainMatchesSymbol(
  ref: ExplainSymbolRef | null | undefined,
  kind: FileNode['symbols'][number]['kind'] | 'file',
  name: string,
) {
  if (!ref) return false
  if (ref.kind === 'file') return kind === 'file'
  if (ref.kind === 'symbol') return kind !== 'file' && ref.name === name
  return ref.kind === kind && ref.name === name
}

export function explainHitsSymbol(
  refs: ExplainSymbolRef[],
  kind: FileNode['symbols'][number]['kind'] | 'file',
  name: string,
) {
  return refs.some((ref) => explainMatchesSymbol(ref, kind, name))
}

export function explainInfoFile(
  step: ExplainStep | null,
  graph: CodebaseGraph,
): FileNode | null {
  if (!step?.info || !step.select) return null
  return (
    graph.files.find((file) => file.id === step.select) ?? {
      id: step.select,
      name: step.select.split('/').pop() || step.select,
      path: step.select,
      folder: '',
      lines: 0,
      language: '',
      symbols: [],
      imports: [],
    }
  )
}

export type ExplainFocus = {
  files: Set<string>
  folders: Set<string>
  select: string | null
  importedBy: boolean
  relations: PatchImport[]
  zoomFiles: string[]
  zoomFolders: string[]
}

export function explainFocus(
  step: ExplainStep | null,
  graph: CodebaseGraph,
): ExplainFocus | null {
  if (!step) return null
  const files = new Set(step.files)
  const folders = new Set(step.folders)
  if (step.select) files.add(step.select)
  const relations: PatchImport[] = step.relations.map((edge) => ({
    from: edge.from,
    to: edge.to,
  }))
  for (const edge of relations) {
    files.add(edge.from)
    files.add(edge.to)
  }
  if (step.select) {
    if (step.importedBy) {
      for (const file of graph.files) {
        if (file.imports.includes(step.select)) files.add(file.id)
      }
    } else {
      const selected = graph.files.find((file) => file.id === step.select)
      for (const id of selected?.imports ?? []) files.add(id)
    }
  }
  for (const file of graph.files) {
    if (folders.has(file.folder)) files.add(file.id)
  }
  for (const id of files) {
    const folder = graph.files.find((file) => file.id === id)?.folder ?? folderOfFile(id)
    if (folder) folders.add(folder)
  }

  const zoomFolders = step.zoom
    ? graph.folders.some((folder) => folder.path === step.zoom)
      ? [step.zoom]
      : []
    : [...step.folders]
  const zoomFiles = step.zoom
    ? graph.files.some((file) => file.id === step.zoom)
      ? [step.zoom]
      : []
    : [...step.files]
  if (step.zoom && zoomFolders.length === 0 && zoomFiles.length === 0) {
    zoomFiles.push(step.zoom)
  }

  return {
    files,
    folders,
    select: step.select,
    importedBy: step.importedBy,
    relations,
    zoomFiles: zoomFiles.length > 0 ? zoomFiles : [...files],
    zoomFolders: zoomFolders.length > 0 ? zoomFolders : [...folders],
  }
}

export function explainHasFocus(focus: ExplainFocus | null) {
  return Boolean(focus && (focus.files.size > 0 || focus.folders.size > 0))
}

export function explainFileFocused(
  focus: ExplainFocus | null,
  fileId: string,
  _folder?: string,
) {
  if (!explainHasFocus(focus) || !focus) return true
  return focus.files.has(fileId)
}

export function explainFileHighlighted(
  focus: ExplainFocus | null,
  fileId: string,
  folder?: string,
) {
  return explainHasFocus(focus) && explainFileFocused(focus, fileId, folder)
}

export function explainFolderFocused(focus: ExplainFocus | null, folderPath: string) {
  if (!explainHasFocus(focus) || !focus) return true
  for (const id of focus.files) {
    if (folderOfFile(id) === folderPath) return true
  }
  return false
}
