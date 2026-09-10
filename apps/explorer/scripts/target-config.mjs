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
const EXPLORER_APP_NAME = 'explorer'
const REPO_TARGET_ID = 'repo'
const LOOK_AT_OFF = new Set(['0', 'false', 'off', 'no'])
const LOOK_AT_ON = new Set(['1', 'true', 'on', 'yes'])

/** Load repo-root `.env` without overriding vars already set in the shell. */
function loadOptionalEnvFile(file) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      if (!key || process.env[key] !== undefined) continue
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  } catch {
    // Optional file.
  }
}

loadOptionalEnvFile(path.join(repoRoot, '.env'))

/** Parse INBASE_LOOK_AT-style toggles. Unset → defaultEnabled. */
export function envToggleEnabled(value, defaultEnabled = true) {
  if (value == null) return defaultEnabled
  const raw = String(value).trim().toLowerCase()
  if (!raw) return defaultEnabled
  if (LOOK_AT_OFF.has(raw)) return false
  if (LOOK_AT_ON.has(raw)) return true
  return defaultEnabled
}

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

/**
 * True when this checkout still has the bundled demo app and the explorer is
 * using its own src/data dir — i.e. `npm run dev`, not `inbase run`.
 * Set INBASE_LOOK_AT=false (also 0/off/no) to hide the Look at control.
 */
export function isWorkspaceDevSwitcherEnabled({
  exampleTarget = defaultTargetRoot,
  resolvedDataDir = dataDir,
  explorerDataDir = defaultDataDir,
  lookAt = process.env.INBASE_LOOK_AT,
} = {}) {
  if (!envToggleEnabled(lookAt, true)) return false
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

function applyTargetRoot(root) {
  targetRoot = path.resolve(root)
  targetName = path.basename(targetRoot)
  targetPathPrefix = resolveTargetPathPrefix(targetRoot)
  process.env.VISUAL_CODER_TARGET = targetRoot
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
