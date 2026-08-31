export function resolvePathValue(value: string | undefined, fallback: string): string
export function resolveTargetRoot(value?: string): string
export function resolveDataDir(value?: string): string
export const dataDir: string
export function persistedTargetFile(dir?: string): string
export function readPersistedTargetId(dir?: string): string | null
export function writePersistedTargetId(id: string, dir?: string): void
export function isWorkspaceDevSwitcherEnabled(options?: {
  exampleTarget?: string
  resolvedDataDir?: string
  explorerDataDir?: string
}): boolean
export type WorkspaceTarget = {
  id: string
  label: string
  root: string
}
export function listWorkspaceTargets(options?: {
  appsRoot?: string
  repositoryRoot?: string
}): WorkspaceTarget[]
export function matchWorkspaceTargetId(
  root: string,
  targets?: WorkspaceTarget[],
): string | null
export function resolveInitialTargetRoot(options?: {
  envTarget?: string
  persistedId?: string | null
  switcherEnabled?: boolean
  targets?: WorkspaceTarget[]
  fallback?: string
}): string
export let targetRoot: string
export let targetName: string
export let targetPathPrefix: string | null
export function resolveTargetPathPrefix(root?: string): string | null
export function currentWorkspaceTargetId(): string | null
export function workspaceDevTargetsState(): {
  enabled: boolean
  currentId: string | null
  targets: Array<{ id: string; label: string }>
}
export function setWorkspaceTarget(id: string): WorkspaceTarget
