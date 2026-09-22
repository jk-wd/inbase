export function normalizeStepId(value: unknown): string
export function stepIdOf(step: { id?: string; index?: number } | null | undefined): string
export function parseStepTitle(raw: unknown): { id: string | null; title: string }
export function parseStepIdParts(
  id: string | null | undefined,
): Array<{ n: number; letter: string }>
export function compareStepIds(left: string, right: string): number
export function waveNumber(id: string | null | undefined): number
export function parentStepIds(
  id: string,
  allIds: Iterable<string> | Set<string>,
): string[]
export function readyStepIds(
  steps: Array<{ id?: string; index?: number }>,
  completedIds?: Iterable<string> | Set<string>,
  currentIds?: Iterable<string> | Set<string>,
): string[]
export function nextInvokedStepIds(
  steps: Array<{ id?: string; index?: number }>,
  completedIds?: Iterable<string> | Set<string>,
  currentIds?: Iterable<string> | Set<string>,
  maxSubagents?: number,
): string[]
export function planLabeledSteps(
  titles: string[],
  startAt?: number,
  delivery?: number | null,
): Array<{ index: number; id: string; title: string; delivery?: number }>
