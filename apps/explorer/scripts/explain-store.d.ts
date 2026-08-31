export const EXPLAIN_FILE: string

export type ExplainRelation = {
  from: string
  to: string
}

export type ExplainSymbolKind =
  | 'function'
  | 'variable'
  | 'class'
  | 'file'
  | 'symbol'

export type ExplainSymbolRef = {
  kind: ExplainSymbolKind
  name: string
}

export type ExplainPendingQuestion = {
  parent: string
  question: string
  from: string
  fromTitle: string
}

export type ExplainTargetKind =
  | 'file'
  | 'folder'
  | 'function'
  | 'variable'
  | 'class'

export type ExplainPendingStart = {
  kind: ExplainTargetKind
  path: string
  name?: string
  question: string
}

export type ExplainStep = {
  index: string
  title: string
  body: string
  asked: string
  files: string[]
  folders: string[]
  select: string | null
  zoom: string | null
  relations: ExplainRelation[]
  importedBy: boolean
  info: boolean
  highlights: ExplainSymbolRef[]
  point: ExplainSymbolRef | null
}

export type ExplainPresentation = 'walk' | 'card'

export type ExplainSession = {
  active: boolean
  question: string
  steps: ExplainStep[]
  currentStep: string
  pendingQuestion: ExplainPendingQuestion | null
  pendingStart: ExplainPendingStart | null
  answering: boolean
  presentation: ExplainPresentation
  updatedAt: string | null
}

export function parseExplainSymbolRef(value: string): ExplainSymbolRef | null
export function emptyExplain(): ExplainSession
export function normalizeExplainPresentation(value: unknown): ExplainPresentation
export function isExplainStepId(value: unknown): value is string
export function explainStepId(value: unknown, fallback?: string): string
export function isExplainDescendant(id: unknown, parent: unknown): boolean
export function topLevelExplainStepId(id: unknown): string
export function isExplainSubStep(id: unknown): boolean
export function stripExplainSubSteps(steps: ExplainStep[]): ExplainStep[]
export function normalizeExplain(value: unknown): ExplainSession
export function readExplain(dataDir: string): ExplainSession
export function parseExplainTargetKind(value: unknown): ExplainTargetKind | null
export function explainTargetLabel(input: {
  kind?: string
  path?: string
  name?: string
}): string
export function explainTargetQuestion(
  kind: ExplainTargetKind,
  path: string,
  name?: string,
): string
export function startExplain(dataDir: string, question: string): ExplainSession
export function requestExplainTarget(
  dataDir: string,
  input: {
    kind: ExplainTargetKind
    path: string
    name?: string
    question?: string
  },
): ExplainSession
export function consumeExplainStart(dataDir: string): ExplainPendingStart | null
export function reportExplain(
  dataDir: string,
  input: { question?: string; parent?: string; steps?: unknown[] },
): ExplainSession
export function setExplainStep(
  dataDir: string,
  step: string | number,
): ExplainSession
export function askExplainQuestion(
  dataDir: string,
  step: string | number,
  question: string,
): ExplainSession
export function consumeExplainQuestion(
  dataDir: string,
): ExplainPendingQuestion | null
export function stopExplain(dataDir: string): ExplainSession
export function parseExplainArgs(args: string[]): {
  question: string
  parent: string
  steps: ExplainStep[]
}
export function parseExplainCli(args: string[]):
  | { action: 'stop' }
  | { action: 'wait' }
  | { action: 'start'; question: string }
  | {
      action: 'report'
      question: string
      parent: string
      steps: ExplainStep[]
    }
