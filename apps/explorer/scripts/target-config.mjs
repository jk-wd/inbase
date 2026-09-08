import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadInbaseConfig, rememberInbaseConfig, resolveConfigPath } from '../../../bin/inbase-config.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const explorerRoot = path.resolve(here, '..')
const repoRoot = path.resolve(explorerRoot, '../..')
const appsDir = path.resolve(explorerRoot, '..')
const defaultTargetRoot = path.resolve(explorerRoot, '../example-target')
const defaultDataDir = path.resolve(explorerRoot, 'src/data')
const DEV_TARGET_FILE = 'dev-target.json'
const PROJECTS_FILE = 'projects.json'
const EXPLORER_APP_NAME = 'explorer'
const REPO_TARGET_ID = 'repo'

export function resolvePathValue(value, fallback) {
  const raw = value?.trim()
  if (!raw) return fallback
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(process.cwd(), raw)
}

export function resolveTargetRoot(value = process.env.VISUAL_CODER_TARGET) {
  return resolvePathValue(value, defaultTargetRoot)
}

export function resolveDataDir(value = process.env.INBASE_DATA_DIR) {
  return resolvePathValue(value, defaultDataDir)
}

export const dataDir = resolveDataDir()

function samePath(left, right) {
  return path.resolve(left) === path.resolve(right)
}

function labelFromFolderName(name) {
  if (name === 'example-target') return 'Example target'
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function persistedTargetFile(dir = dataDir) {
  return path.join(dir, DEV_TARGET_FILE)
}

export function readPersistedTargetId(dir = dataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(persistedTargetFile(dir), 'utf8'))
    return typeof parsed?.id === 'string' && parsed.id.trim() ? parsed.id.trim() : null
  } catch {
    return null
  }
}

export function writePersistedTargetId(id, dir = dataDir) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(persistedTargetFile(dir), `${JSON.stringify({ id }, null, 2)}\n`)
}

export function projectsFile(dir = dataDir) {
  return path.join(dir, PROJECTS_FILE)
}

function disambiguateProjectLabels(projects) {
  const counts = new Map()
  for (const project of projects) {
    const base = path.basename(project.root)
    counts.set(base, (counts.get(base) ?? 0) + 1)
  }
  return projects.map((project) => {
    const base = path.basename(project.root)
    if ((counts.get(base) ?? 0) <= 1) {
      return { ...project, label: labelFromFolderName(base) }
    }
    const parent = path.basename(path.dirname(project.root))
    return {
      ...project,
      label: `${labelFromFolderName(parent)}/${labelFromFolderName(base)}`,
    }
  })
}

export function readRegisteredProjects(dir = dataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(projectsFile(dir), 'utf8'))
    const list = Array.isArray(parsed?.projects) ? parsed.projects : []
    const projects = []
    const seen = new Set()
    for (const item of list) {
      const root = typeof item?.root === 'string' ? path.resolve(item.root) : ''
      if (!root || seen.has(root)) continue
      seen.add(root)
      const id =
        typeof item.id === 'string' && item.id.trim() ? item.id.trim() : root
      projects.push({ id, root })
    }
    const labeled = disambiguateProjectLabels(projects)
    const currentId =
      typeof parsed?.currentId === 'string' && parsed.currentId.trim()
        ? parsed.currentId.trim()
        : null
    return { currentId, projects: labeled }
  } catch {
    return { currentId: null, projects: [] }
  }
}

export function writeRegisteredProjects(
  { currentId = null, projects = [] } = {},
  dir = dataDir,
) {
  const labeled = disambiguateProjectLabels(
    projects.map((project) => ({
      id:
        typeof project.id === 'string' && project.id.trim()
          ? project.id.trim()
          : path.resolve(project.root),
      root: path.resolve(project.root),
    })),
  )
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    projectsFile(dir),
    `${JSON.stringify({ currentId, projects: labeled }, null, 2)}\n`,
  )
  return { currentId, projects: labeled }
}

export function applyTargetRoot(root) {
  targetRoot = path.resolve(root)
  targetName = path.basename(targetRoot)
  targetPathPrefix = resolveTargetPathPrefix(targetRoot)
  process.env.VISUAL_CODER_TARGET = targetRoot
}

export function registerProject(
  root,
  { dir = dataDir, select = true } = {},
) {
  const resolved = path.resolve(root)
  const state = readRegisteredProjects(dir)
  let projects = [...state.projects]
  if (
    samePath(dir, dataDir) &&
    projects.length === 0 &&
    targetRoot &&
    !samePath(targetRoot, resolved)
  ) {
    projects.push({
      id: path.resolve(targetRoot),
      root: path.resolve(targetRoot),
    })
  }
  const existing = projects.find((project) => samePath(project.root, resolved))
  const id = existing?.id ?? resolved
  if (!existing) {
    projects = [...projects, { id, root: resolved }]
  }
  const currentId = select ? id : (state.currentId ?? id)
  const next = writeRegisteredProjects({ currentId, projects }, dir)
  if (select) applyTargetRoot(resolved)
  return {
    ...next,
    selected: next.projects.find((project) => project.id === id) ?? null,
  }
}

export function selectProject(id, { dir = dataDir } = {}) {
  const registered = readRegisteredProjects(dir)
  const fromRegistered = registered.projects.find((project) => project.id === id)
  if (fromRegistered) {
    applyTargetRoot(fromRegistered.root)
    writeRegisteredProjects(
      { currentId: fromRegistered.id, projects: registered.projects },
      dir,
    )
    writePersistedTargetId(fromRegistered.id, dir)
    return fromRegistered
  }
  if (isWorkspaceDevSwitcherEnabled()) {
    return setWorkspaceTarget(id)
  }
  throw new Error(`Unknown project: ${id}`)
}

export function projectsState({ dir = dataDir } = {}) {
  const registered = readRegisteredProjects(dir)
  if (registered.projects.length > 0) {
    const current =
      registered.projects.find((project) => samePath(project.root, targetRoot)) ??
      registered.projects.find((project) => project.id === registered.currentId)
    return {
      enabled: true,
      currentId: current?.id ?? registered.currentId,
      targets: registered.projects.map(({ id, label }) => ({ id, label })),
    }
  }
  return workspaceDevTargetsState()
}

/**
 * True when this checkout still has the bundled demo app and the explorer is
 * using its own src/data dir — i.e. `npm run dev`, not `inbase run`.
 */
export function isWorkspaceDevSwitcherEnabled({
  exampleTarget = defaultTargetRoot,
  resolvedDataDir = dataDir,
  explorerDataDir = defaultDataDir,
} = {}) {
  return fs.existsSync(exampleTarget) && samePath(resolvedDataDir, explorerDataDir)
}

export function listWorkspaceTargets({
  appsRoot = appsDir,
  repositoryRoot = repoRoot,
} = {}) {
  const apps = []
  try {
    for (const entry of fs.readdirSync(appsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name === EXPLORER_APP_NAME || entry.name.startsWith('.')) continue
      apps.push({
        id: entry.name,
        label: labelFromFolderName(entry.name),
        root: path.resolve(appsRoot, entry.name),
      })
    }
  } catch {
    // No apps directory in published layouts.
  }
  apps.sort((left, right) => {
    if (left.id === 'example-target') return -1
    if (right.id === 'example-target') return 1
    return left.id.localeCompare(right.id)
  })
  return [
    ...apps,
    {
      id: REPO_TARGET_ID,
      label: 'Complete repo',
      root: path.resolve(repositoryRoot),
    },
  ]
}

export function matchWorkspaceTargetId(root, targets = listWorkspaceTargets()) {
  const resolved = path.resolve(root)
  return targets.find((target) => samePath(target.root, resolved))?.id ?? null
}

export function resolveInitialTargetRoot({
  envTarget = process.env.VISUAL_CODER_TARGET,
  persistedId = null,
  switcherEnabled = false,
  targets = [],
  fallback = defaultTargetRoot,
  configTarget = null,
} = {}) {
  const fromEnv = envTarget?.trim()
  if (fromEnv) return resolveTargetRoot(fromEnv)
  if (switcherEnabled && persistedId) {
    const match = targets.find((target) => target.id === persistedId)
    if (match) return match.root
  }
  if (configTarget) return path.resolve(configTarget)
  return fallback
}

const switcherEnabledAtBoot = isWorkspaceDevSwitcherEnabled()
const bootTargets = switcherEnabledAtBoot ? listWorkspaceTargets() : []
const bootConfig = rememberInbaseConfig(loadInbaseConfig())
const bootConfigTarget =
  bootConfig.target && bootConfig.dir
    ? resolveConfigPath(bootConfig.target, bootConfig.dir)
    : null

export let targetRoot = resolveInitialTargetRoot({
  persistedId: switcherEnabledAtBoot ? readPersistedTargetId() : null,
  switcherEnabled: switcherEnabledAtBoot,
  targets: bootTargets,
  configTarget: bootConfigTarget,
})
export let targetName = path.basename(targetRoot)
export let targetPathPrefix = null

/**
 * Agents write diffs against repo-relative paths, so a target that lives inside
 * this repo carries a prefix that has to be stripped to reach a scan file id.
 * Targets outside the repo have no such prefix.
 */
export function resolveTargetPathPrefix(root = targetRoot) {
  const override = process.env.VISUAL_CODER_TARGET_PREFIX?.trim()
  if (override) return override.endsWith('/') ? override : `${override}/`

  const relative = path.relative(repoRoot, root)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return `${relative.split(path.sep).join('/')}/`
}

targetPathPrefix = resolveTargetPathPrefix(targetRoot)

export function currentWorkspaceTargetId() {
  return matchWorkspaceTargetId(targetRoot)
}

export function workspaceDevTargetsState() {
  if (!isWorkspaceDevSwitcherEnabled()) {
    return { enabled: false, currentId: null, targets: [] }
  }
  const targets = listWorkspaceTargets()
  const currentId = matchWorkspaceTargetId(targetRoot, targets) ?? 'custom'
  const publicTargets = targets.map(({ id, label }) => ({ id, label }))
  if (currentId === 'custom') {
    publicTargets.push({ id: 'custom', label: targetName })
  }
  return { enabled: true, currentId, targets: publicTargets }
}

export function setWorkspaceTarget(id) {
  const targets = listWorkspaceTargets()
  const match = targets.find((target) => target.id === id)
  if (!match) throw new Error(`Unknown workspace target: ${id}`)
  applyTargetRoot(match.root)
  writePersistedTargetId(match.id)
  return match
}
