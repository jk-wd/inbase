import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { applyUnifiedPatch } from './patch-lib.mjs'
import {
  attachChangeNotes,
  dropMassKnownCreates,
  emptyChangeOverlay,
  mergeChangeNotes,
  overlayFileIds,
  overlayFromPatchText,
  overlayHasChanges,
  normalizeChangeOverlay,
} from './change-overlay.mjs'
import {
  hasGitRepo,
  readWorkingTreeChanges,
  withAbsentMappedFiles,
} from './branch-changes.mjs'
import { diffSourceTrees, restoreSourceTree, snapshotSourceTree } from './tree-diff.mjs'
import { readExplain } from './explain-store.mjs'
import {
  nextInvokedStepIds,
  planLabeledSteps,
  stepIdOf,
} from './plan-steps.mjs'

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const CONNECTED_TTL_MS = 15_000
const STALLED_WAIT_MS = 2_000
export const SESSION_COLORS = [
  { id: 'blue', name: 'Blue', hex: '#38bdf8' },
  { id: 'coral', name: 'Coral', hex: '#f87171' },
  { id: 'amber', name: 'Amber', hex: '#fbbf24' },
  { id: 'lime', name: 'Lime', hex: '#a3e635' },
  { id: 'orange', name: 'Orange', hex: '#fb923c' },
  { id: 'violet', name: 'Violet', hex: '#c084fc' },
  { id: 'teal', name: 'Teal', hex: '#2dd4bf' },
  { id: 'crimson', name: 'Crimson', hex: '#dc2626' },
  { id: 'forest', name: 'Forest', hex: '#15803d' },
  { id: 'grey', name: 'Grey', hex: '#4b5563' },
  { id: 'white', name: 'White', hex: '#f4f4f5' },
]
export const SESSION_SLOT_COUNT = SESSION_COLORS.length
export const DEFAULT_SESSION_COLOR = SESSION_COLORS[0]
export const SESSION_COLOR_ALIASES = {
  blue: 'blue',
  sky: 'blue',
  coral: 'coral',
  red: 'coral',
  amber: 'amber',
  yellow: 'amber',
  lime: 'lime',
  green: 'lime',
  orange: 'orange',
  violet: 'violet',
  purple: 'violet',
  teal: 'teal',
  crimson: 'crimson',
  forest: 'forest',
  darkgreen: 'forest',
  grey: 'grey',
  gray: 'grey',
  white: 'white',
}

function joinOrList(items) {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} or ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, or ${items.at(-1)}`
}

function sessionColorCommandHelp() {
  const commands = SESSION_COLORS.map((color) => `/${color.id}`)
  const aliases = Object.entries(SESSION_COLOR_ALIASES)
    .filter(([alias, id]) => alias !== id)
    .map(([alias]) => `/${alias}`)
  return `Connect with /inbase, /connect, or ${joinOrList(commands)} (aliases: ${joinOrList(aliases)}).`
}

export const ALL_COLORS_LOCKED_MESSAGE =
  'VISUAL_CODER_ALL_COLORS_LOCKED Every color already has a chat connected. Click Done in a session window or type /stop in a connected chat, then try again.'
export const NOT_RUNNING_MESSAGE =
  "VISUAL_CODER_NOT_RUNNING Inbase isn't running. Start it with `npx inbase run`, then send this request again."
export const NO_HIERARCHY_BLUEPRINT_MESSAGE =
  'VISUAL_CODER_NO_BLUEPRINT No enabled blueprint is on the map. Draw or load a blueprint first, then type /connect again.'
export function colorUnknownMessage(query) {
  const label = typeof query === 'string' && query.trim() ? query.trim() : 'That color'
  return `VISUAL_CODER_COLOR_UNKNOWN ${label} is not a chat color. ${sessionColorCommandHelp()}`
}
export function colorBusyMessage(colorName) {
  return `VISUAL_CODER_COLOR_BUSY The ${colorName} session already has a chat connected. Click Done in that session window or type /stop in that chat, then try again.`
}
export function colorMissingMessage(colorName) {
  return `VISUAL_CODER_COLOR_UNKNOWN No ${colorName} session is open. Start Inbase with \`npx inbase run\`, then try again.`
}
export const MAX_CONTEXT_FILES = 16
export const MAX_CONTEXT_FILE_BYTES = 8 * 1024 * 1024
export const MAX_CONTEXT_TOTAL_BYTES = 24 * 1024 * 1024
const CONTEXT_TEXT_INLINE_BYTES = 100_000

export function assertSessionId(value) {
  if (typeof value !== 'string' || !SESSION_ID.test(value) || value === '.' || value === '..') {
    throw new Error(
      'sessionId must be 1-128 letters, numbers, dots, underscores, or hyphens',
    )
  }
  return value
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function atomicWrite(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, contents)
  fs.renameSync(temporary, file)
}

function featureName(value) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed
}

function sessionName(value) {
  return featureName(value)
}

function resolvedSessionName(manifest) {
  return sessionName(manifest?.name) || sessionName(manifest?.feature)
}

export function resolveSessionColor(colorId) {
  if (typeof colorId !== 'string' || colorId.trim() === '') return null
  return SESSION_COLORS.find((entry) => entry.id === colorId) ?? null
}

export function sessionColorOrderIndex(colorId) {
  const index = SESSION_COLORS.findIndex((entry) => entry.id === colorId)
  return index === -1 ? SESSION_COLORS.length : index
}

export function compareSessionColorOrder(left, right) {
  return sessionColorOrderIndex(left) - sessionColorOrderIndex(right)
}

function lookupSessionColor(value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  const key = value.trim().toLowerCase()
  const id = SESSION_COLOR_ALIASES[key] ?? resolveSessionColor(key)?.id ?? null
  return resolveSessionColor(id)
}

export function namedBlueprintDependsOn(colorId, value, graph = null) {
  const self = lookupSessionColor(colorId)?.id ?? null
  const seen = new Set()
  const ids = []
  for (const raw of Array.isArray(value) ? value : []) {
    const next = lookupSessionColor(
      typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? raw.id : null,
    )
    if (!next || next.id === self || seen.has(next.id)) continue
    if (graph && !canDependOn(graph, self, next.id)) continue
    seen.add(next.id)
    ids.push(next.id)
  }
  return ids
}

export function colorDependsGraph(layers) {
  const graph = Object.fromEntries(SESSION_COLORS.map((color) => [color.id, []]))
  for (const layer of Array.isArray(layers) ? layers : []) {
    const color = lookupSessionColor(layer?.color)
    if (!color) continue
    graph[color.id] = namedBlueprintDependsOn(color.id, layer.dependsOn)
  }
  return graph
}

function reachableDependsOn(graph, from) {
  const seen = new Set()
  const stack = [...(graph?.[from] ?? [])]
  while (stack.length) {
    const id = stack.pop()
    if (!id || seen.has(id)) continue
    seen.add(id)
    for (const next of graph?.[id] ?? []) stack.push(next)
  }
  return seen
}

export function canDependOn(graph, from, to) {
  const source = lookupSessionColor(from)
  const target = lookupSessionColor(to)
  if (!source || !target || source.id === target.id) return false
  return !reachableDependsOn(graph, target.id).has(source.id)
}

export function colorsDependingOn(graph, colorId) {
  const color = lookupSessionColor(colorId)
  if (!color) return []
  return SESSION_COLORS.filter(
    (item) => item.id !== color.id && (graph?.[item.id] ?? []).includes(color.id),
  ).map((item) => item.id)
}

export function sessionColorRelations(dataDir, sessionId) {
  const locals = listLocalBlueprints(dataDir)
  const graph = colorDependsGraph(locals)
  const color = resolveSessionColor(readManifest(dataDir, sessionId)?.color)
  const colorId = color?.id ?? null
  const compact = {}
  for (const [id, ids] of Object.entries(graph)) {
    if (ids.length > 0) compact[id] = ids
  }
  return {
    color: colorId,
    colorName: color?.name ?? null,
    dependsOn: colorId ? graph[colorId] ?? [] : [],
    dependents: colorId ? colorsDependingOn(graph, colorId) : [],
    graph: compact,
  }
}

export function parseSessionColorQuery(value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  const key = value.trim()
  const color = lookupSessionColor(key)
  if (!color) throw new Error(colorUnknownMessage(key))
  return color
}

export function resolveSessionId(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      'sessionId must be 1-128 letters, numbers, dots, underscores, or hyphens',
    )
  }
  const key = value.trim()
  return lookupSessionColor(key)?.id ?? assertSessionId(key)
}

function assignedSessionColors(dataDir) {
  const used = new Set()
  for (const sessionId of listOpenSessionIds(dataDir)) {
    const color = readManifest(dataDir, sessionId)?.color
    if (resolveSessionColor(color)) used.add(color)
    if (resolveSessionColor(sessionId)) used.add(sessionId)
  }
  return used
}

function nextSessionColor(dataDir) {
  const used = assignedSessionColors(dataDir)
  return SESSION_COLORS.find((entry) => !used.has(entry.id))?.id ?? null
}

function ensureManifestColor(dataDir, manifest) {
  if (!manifest) return manifest
  if (resolveSessionColor(manifest.color)) return manifest
  if (
    isSessionStopped(dataDir, manifest.sessionId) ||
    isSessionReleased(dataDir, manifest.sessionId)
  ) {
    return manifest
  }
  manifest.color =
    resolveSessionColor(manifest.sessionId)?.id ?? nextSessionColor(dataDir) ?? SESSION_COLORS[0].id
  const { manifest: file } = sessionPaths(dataDir, manifest.sessionId)
  atomicWrite(file, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

export function sessionPaths(dataDir, sessionId) {
  const safeId = assertSessionId(sessionId)
  const root = path.join(dataDir, 'diff-sessions', safeId)
  return {
    root,
    diffs: path.join(root, 'diffs'),
    manifest: path.join(root, 'manifest.json'),
    blueprint: path.join(root, 'blueprint.json'),
    baseline: path.join(root, 'baseline.json'),
    baselineFiles: path.join(root, 'baseline'),
    preStep: path.join(root, 'pre-step'),
    context: path.join(root, 'context'),
    stopped: path.join(dataDir, 'diff-sessions', `${safeId}.stopped`),
    released: path.join(dataDir, 'diff-sessions', `${safeId}.released`),
  }
}

export function sessionStoppedError(sessionId) {
  return new Error(
    `VISUAL_CODER_STOPPED Session ${assertSessionId(sessionId)} was stopped. Do not modify project files.`,
  )
}

function sessionMissingError(sessionId) {
  return new Error(`No workflow session found for ${assertSessionId(sessionId)}`)
}

export function isSessionStopped(dataDir, sessionId) {
  return fs.existsSync(sessionPaths(dataDir, sessionId).stopped)
}

export function isSessionReleased(dataDir, sessionId) {
  return fs.existsSync(sessionPaths(dataDir, sessionId).released)
}

export function isWorkflowStopped(dataDir, sessionId) {
  const safeId = assertSessionId(sessionId)
  const manifest = readManifest(dataDir, safeId)
  if (manifest?.phase === 'stopped') return true
  return !manifest && isSessionStopped(dataDir, safeId)
}

function writeStoppedMarker(dataDir, sessionId) {
  const { stopped } = sessionPaths(dataDir, sessionId)
  atomicWrite(
    stopped,
    `${JSON.stringify({ sessionId: assertSessionId(sessionId), stoppedAt: new Date().toISOString() }, null, 2)}\n`,
  )
}

function writeReleasedMarker(dataDir, sessionId) {
  const { released } = sessionPaths(dataDir, sessionId)
  atomicWrite(
    released,
    `${JSON.stringify({ sessionId: assertSessionId(sessionId), releasedAt: new Date().toISOString() }, null, 2)}\n`,
  )
}

function clearStoppedMarker(dataDir, sessionId) {
  const { stopped } = sessionPaths(dataDir, sessionId)
  if (fs.existsSync(stopped)) fs.unlinkSync(stopped)
}

function clearReleasedMarker(dataDir, sessionId) {
  const { released } = sessionPaths(dataDir, sessionId)
  if (fs.existsSync(released)) fs.unlinkSync(released)
}

function assertSessionWritable(dataDir, sessionId) {
  const safeId = assertSessionId(sessionId)
  if (isSessionStopped(dataDir, safeId)) throw sessionStoppedError(safeId)
  if (isSessionReleased(dataDir, safeId)) throw sessionMissingError(safeId)
  return safeId
}

function requireManifest(dataDir, sessionId, missingMessage) {
  const safeId = assertSessionId(sessionId)
  const manifest = readManifest(dataDir, safeId)
  if (manifest) return manifest
  if (isSessionStopped(dataDir, safeId)) throw sessionStoppedError(safeId)
  if (isSessionReleased(dataDir, safeId)) throw sessionMissingError(safeId)
  throw new Error(missingMessage ?? `Unknown session ${safeId}`)
}

export function resolveTargetFile(targetRoot, fileId) {
  if (typeof fileId !== 'string' || fileId.trim() === '') {
    throw new Error('fileId is required')
  }
  const normalized = fileId.trim().replaceAll('\\', '/').replace(/^\/+/, '')
  if (!normalized || normalized === '.' || normalized.includes('..')) {
    throw new Error(`Invalid file id ${fileId}`)
  }
  const root = path.resolve(targetRoot)
  const absolute = path.resolve(root, normalized)
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  if (absolute !== root && !absolute.startsWith(prefix)) {
    throw new Error(`Invalid file id ${fileId}`)
  }
  return { id: normalized, absolute }
}

const LEGACY_STATE_FILES = [
  'active-session.json',
  'blueprint-session.json',
  'session-pool.json',
]

export function userContextFile(dataDir) {
  return path.join(dataDir, 'user-context.json')
}

function readUserContextDocument(dataDir) {
  const value = readJson(userContextFile(dataDir), null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value
}

function writeUserContextDocument(dataDir, next) {
  atomicWrite(userContextFile(dataDir), `${JSON.stringify(next, null, 2)}\n`)
}

function parseStoredSessionId(value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    return assertSessionId(value)
  } catch {
    return null
  }
}

function readLegacyActiveSession(dataDir) {
  const value = readJson(path.join(dataDir, 'active-session.json'), null)
  return parseStoredSessionId(value?.sessionId)
}

function removeLegacyStateFiles(dataDir) {
  for (const name of LEGACY_STATE_FILES) {
    const file = path.join(dataDir, name)
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file)
    } catch {
      // Best-effort cleanup of superseded editor-state files.
    }
  }
}

export function readActiveSession(dataDir) {
  return (
    parseStoredSessionId(readUserContextDocument(dataDir).focusedSessionId) ??
    readLegacyActiveSession(dataDir)
  )
}

export function writeActiveSession(dataDir, sessionId) {
  const next = { ...readUserContextDocument(dataDir) }
  next.focusedSessionId = sessionId ? assertSessionId(sessionId) : null
  writeUserContextDocument(dataDir, next)
  removeLegacyStateFiles(dataDir)
}

function connectionFile(dataDir, sessionId) {
  return path.join(sessionPaths(dataDir, sessionId).root, 'connected.json')
}

function ackFile(dataDir, sessionId) {
  return path.join(sessionPaths(dataDir, sessionId).root, 'ack.json')
}

export function recordSessionAck(dataDir, sessionId, kind, detail = '') {
  const safeId = assertSessionId(sessionId)
  if (isSessionReleased(dataDir, safeId)) return null
  if (isSessionStopped(dataDir, safeId) && kind !== 'stopped' && kind !== 'finished') {
    return null
  }
  const payload = {
    kind: String(kind),
    detail: String(detail ?? ''),
    at: new Date().toISOString(),
  }
  try {
    atomicWrite(ackFile(dataDir, safeId), `${JSON.stringify(payload, null, 2)}\n`)
  } catch {
    return null
  }
  return payload
}

function readSessionAck(dataDir, sessionId) {
  const value = readJson(ackFile(dataDir, sessionId), null)
  if (!value || typeof value.kind !== 'string' || value.kind.trim() === '') return null
  return {
    kind: value.kind,
    detail: typeof value.detail === 'string' ? value.detail : '',
    at: typeof value.at === 'string' ? value.at : null,
  }
}

function isFreshTimestamp(value, now = Date.now()) {
  if (typeof value !== 'string') return false
  const at = Date.parse(value)
  return Number.isFinite(at) && now - at >= 0 && now - at < CONNECTED_TTL_MS
}

export function touchSessionConnection(dataDir, sessionId) {
  const safeId = assertSessionId(sessionId)
  if (isSessionStopped(dataDir, safeId) || isSessionReleased(dataDir, safeId)) return
  const manifest = readManifest(dataDir, safeId)
  if (!manifest) return
  if (sessionIsWaitingToAttach(manifest) || !isChatLocked(dataDir, safeId)) return
  atomicWrite(
    connectionFile(dataDir, safeId),
    `${JSON.stringify({ sessionId: safeId, connectedAt: new Date().toISOString() }, null, 2)}\n`,
  )
}

function waiterSessionIds() {
  return new Set()
}

function isTerminalSession(manifest) {
  return (
    !manifest ||
    manifest.phase === 'finished' ||
    manifest.phase === 'stopped' ||
    manifest.status === 'finished' ||
    manifest.status === 'rejected'
  )
}

function isAcceptedSession(manifest) {
  return (
    manifest?.phase === 'finished' ||
    manifest?.status === 'finished'
  )
}

function shouldRestoreDiscardedSession(_manifest) {
  // Abandoned session overlays are UI-only. Never rewind the live working tree;
  // the map shows latest git changes, and history walking stays visual.
  return false
}

function isStalledWorking(manifest, waiterIds, sessionId, now = Date.now()) {
  if (manifest.phase !== 'working') return false
  if (!waiterIds.has(sessionId)) return false
  const started = Date.parse(manifest.workStartedAt)
  return Number.isFinite(started) && now - started >= STALLED_WAIT_MS
}

export function isSessionConnected(
  dataDir,
  sessionId,
  _waiterIds = waiterSessionIds(),
) {
  const safeId = assertSessionId(sessionId)
  const manifest = readManifest(dataDir, safeId)
  if (isTerminalSession(manifest)) return false
  if (sessionIsWaitingToAttach(manifest) || !isChatLocked(dataDir, safeId)) {
    return false
  }
  return true
}

function diffSessionsRoot(dataDir) {
  return path.join(dataDir, 'diff-sessions')
}

export function listStoredSessionIds(dataDir) {
  const root = diffSessionsRoot(dataDir)
  if (!fs.existsSync(root)) return []
  const ids = new Set()
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === '.gitkeep') continue
    const name =
      entry.isFile() && entry.name.endsWith('.stopped')
        ? entry.name.slice(0, -'.stopped'.length)
        : entry.name
    try {
      ids.add(assertSessionId(name))
    } catch {
      // Skip files that are not valid session ids.
    }
  }
  return [...ids]
}

export function listOpenSessionIds(dataDir, waiterIds = waiterSessionIds()) {
  const root = diffSessionsRoot(dataDir)
  if (!fs.existsSync(root)) return []
  const sessions = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      const sessionId = assertSessionId(entry.name)
      const manifest = readManifest(dataDir, sessionId)
      if (isTerminalSession(manifest)) continue
      sessions.push({
        sessionId,
        createdAt: typeof manifest.createdAt === 'string' ? manifest.createdAt : '',
      })
    } catch {
      // Skip folders that are not valid session ids.
    }
  }
  sessions.sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt.localeCompare(right.createdAt)
    }
    return left.sessionId.localeCompare(right.sessionId)
  })
  return sessions.map((item) => item.sessionId)
}

export function listSessionIntents(dataDir, knownFileIds = [], targetRoot = null) {
  const waiters = waiterSessionIds()
  return listOpenSessionIds(dataDir, waiters)
    .map((sessionId) =>
      sessionIntent(
        dataDir,
        sessionId,
        knownFileIds,
        undefined,
        waiters,
        targetRoot,
      ),
    )
    .filter(Boolean)
    .sort((left, right) => compareSessionColorOrder(left.color, right.color))
}

export function focusSession(dataDir, sessionId) {
  const safeId = assertSessionId(sessionId)
  requireManifest(dataDir, safeId)
  writeActiveSession(dataDir, safeId)
  return safeId
}

function chatsFile(dataDir) {
  return path.join(dataDir, 'chats.json')
}

function emptyChats() {
  const chats = {}
  for (const color of SESSION_COLORS) {
    chats[color.id] = { locked: false }
  }
  return chats
}

export function readChats(dataDir) {
  const value = readJson(chatsFile(dataDir), null)
  const chats = emptyChats()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return chats
  for (const color of SESSION_COLORS) {
    const entry = value[color.id]
    chats[color.id] = { locked: entry?.locked === true }
  }
  return chats
}

function writeChats(dataDir, chats) {
  const next = emptyChats()
  for (const color of SESSION_COLORS) {
    next[color.id] = { locked: Boolean(chats?.[color.id]?.locked) }
  }
  atomicWrite(chatsFile(dataDir), `${JSON.stringify(next, null, 2)}\n`)
}

export function isChatLocked(dataDir, sessionId) {
  const color = resolveSessionColor(sessionId)
  if (color) return readChats(dataDir)[color.id].locked
  const manifest = readManifest(dataDir, sessionId)
  return Boolean(manifest) && manifest.awaitingAttach !== true
}

function setChatLocked(dataDir, sessionId, locked) {
  const safeId = assertSessionId(sessionId)
  const color = resolveSessionColor(safeId)
  if (color) {
    const chats = readChats(dataDir)
    chats[color.id] = { locked: Boolean(locked) }
    writeChats(dataDir, chats)
  }
  const manifest = readManifest(dataDir, safeId)
  if (!manifest) return
  manifest.awaitingAttach = !locked
  writeManifest(dataDir, manifest)
}

function sessionPoolCount(options = {}) {
  const count = options.count
  return Number.isInteger(count) && count > 0 ? count : SESSION_SLOT_COUNT
}

function hasColorSlot(dataDir) {
  return SESSION_COLORS.some((color) => readManifest(dataDir, color.id))
}

export function ensureSessionPool(dataDir, options = {}) {
  const active = readActiveSession(dataDir)
  if (active) writeActiveSession(dataDir, active)
  else removeLegacyStateFiles(dataDir)
  const count = sessionPoolCount(options)
  const created = []
  writeChats(dataDir, readChats(dataDir))
  for (const color of SESSION_COLORS.slice(0, count)) {
    const existing = readManifest(dataDir, color.id)
    if (existing && !isTerminalSession(existing)) continue
    created.push(setupSession(dataDir, { sessionId: color.id, focus: false }))
  }
  if (options.focus !== false && !readActiveSession(dataDir)) {
    const next = nextAttachSessionId(dataDir) ?? listOpenSessionIds(dataDir)[0]
    if (next) focusSession(dataDir, next)
  }
  return created
}

function refillSessionPool(dataDir) {
  if (!hasColorSlot(dataDir)) return []
  return ensureSessionPool(dataDir, { focus: false })
}

function sessionIsWaitingToAttach(manifest) {
  return Boolean(manifest?.awaitingAttach)
}

export function listAttachQueue(dataDir) {
  const waiting = []
  for (const sessionId of listOpenSessionIds(dataDir)) {
    if (!sessionIsWaitingToAttach(readManifest(dataDir, sessionId))) continue
    waiting.push(sessionId)
  }
  waiting.sort((left, right) => {
    const order = compareSessionColorOrder(
      readManifest(dataDir, left)?.color ?? left,
      readManifest(dataDir, right)?.color ?? right,
    )
    if (order !== 0) return order
    return left.localeCompare(right)
  })
  return waiting
}

export function nextAttachSessionId(dataDir) {
  return listAttachQueue(dataDir)[0] ?? null
}

function assignedHierarchyLayers(locals) {
  return locals.filter(
    (layer) =>
      layer.enabled ||
      (layer.files?.length ?? 0) > 0 ||
      (layer.folders?.length ?? 0) > 0 ||
      (layer.dependsOn?.length ?? 0) > 0,
  )
}

export function firstEnabledBlueprintColor(dataDir) {
  const enabled = listLocalBlueprints(dataDir)
    .filter((layer) => layer.enabled)
    .sort((left, right) => compareSessionColorOrder(left.color, right.color))
  return enabled[0]?.color ?? null
}

export function firstHierarchyAttachColor(dataDir) {
  return firstEnabledBlueprintColor(dataDir)
}

function hierarchyColorIds(assigned) {
  const ids = new Set(assigned.map((layer) => layer.color))
  for (const layer of assigned) {
    for (const dep of layer.dependsOn ?? []) {
      if (lookupSessionColor(dep)) ids.add(dep)
    }
  }
  return ids
}

export function parallelColorWaves(dependsOnByColor) {
  const colors = Object.keys(dependsOnByColor)
  const remaining = new Set(colors)
  const waves = []
  while (remaining.size > 0) {
    const wave = colors.filter((id) => {
      if (!remaining.has(id)) return false
      return (dependsOnByColor[id] ?? []).every((dep) => !remaining.has(dep))
    })
    if (wave.length === 0) {
      return { waves, cycle: true, leftover: [...remaining] }
    }
    waves.push(wave)
    for (const id of wave) remaining.delete(id)
  }
  return { waves, cycle: false, leftover: [] }
}

function undirectedColorComponent(graph, start, allowed) {
  const seen = new Set()
  const stack = [start]
  while (stack.length) {
    const id = stack.pop()
    if (!id || seen.has(id) || !allowed.has(id)) continue
    seen.add(id)
    for (const dep of graph[id] ?? []) stack.push(dep)
    for (const [other, deps] of Object.entries(graph)) {
      if ((deps ?? []).includes(id)) stack.push(other)
    }
  }
  return seen
}

function compactConnectedLayer(layer, attached) {
  return {
    color: layer.color,
    colorName: layer.colorName,
    enabled: Boolean(layer.enabled),
    attached: attached === true,
    dependsOn: Array.isArray(layer.dependsOn) ? [...layer.dependsOn] : [],
    files: layer.files ?? [],
    folders: layer.folders ?? [],
    addedFunctions: layer.addedFunctions ?? [],
    addedVariables: layer.addedVariables ?? [],
    addedImports: layer.addedImports ?? [],
    notes: layer.notes ?? [],
    pointers: layer.pointers ?? [],
  }
}

export function sessionSubagentPlan(dataDir, sessionId, maxSubagents = 4) {
  const locals = listLocalBlueprints(dataDir)
  const assigned = assignedHierarchyLayers(locals)
  const allowed = hierarchyColorIds(assigned)
  const graph = colorDependsGraph(
    locals.filter((layer) => allowed.has(layer.color)),
  )
  const color = resolveSessionColor(readManifest(dataDir, sessionId)?.color)
  const colorId = color?.id ?? null
  const empty = {
    color: colorId,
    colorName: color?.name ?? null,
    connected: [],
    waves: [],
    waitFor: [],
    spawnNow: [],
    spawnParallel: [],
    spawnAfterThis: [],
    attached: {},
    layers: [],
    maxSubagents,
  }
  if (!colorId || !allowed.has(colorId)) return empty

  const connected = undirectedColorComponent(graph, colorId, allowed)
  const connectedGraph = {}
  for (const item of SESSION_COLORS) {
    if (!connected.has(item.id)) continue
    connectedGraph[item.id] = (graph[item.id] ?? []).filter((dep) =>
      connected.has(dep),
    )
  }
  const { waves } = parallelColorWaves(connectedGraph)
  const attached = {}
  for (const id of connected) {
    const sid = findSessionIdByColor(dataDir, id)
    attached[id] = Boolean(sid && isChatLocked(dataDir, sid))
  }
  const thisWaveIndex = waves.findIndex((wave) => wave.includes(colorId))
  const waitFor = []
  for (let i = 0; i < thisWaveIndex; i++) waitFor.push(...waves[i])
  const cap = Number.isInteger(maxSubagents) && maxSubagents > 0 ? maxSubagents : 0
  let spawnNow = []
  let spawnParallel = []
  if (cap > 0) {
    for (let i = 0; i < thisWaveIndex; i++) {
      const unattached = waves[i].filter((id) => !attached[id])
      if (unattached.length > 0) {
        spawnNow = unattached
        break
      }
    }
    if (spawnNow.length === 0) {
      spawnParallel = (waves[thisWaveIndex] ?? []).filter(
        (id) => id !== colorId && !attached[id],
      )
    }
  }
  const spawnAfterThis =
    cap > 0 && thisWaveIndex >= 0
      ? (waves[thisWaveIndex + 1] ?? []).filter(
          (id) => id !== colorId && !attached[id],
        )
      : []
  const layers = locals
    .filter((layer) => connected.has(layer.color))
    .map((layer) => compactConnectedLayer(layer, attached[layer.color]))

  return {
    color: colorId,
    colorName: color?.name ?? null,
    connected: SESSION_COLORS.map((item) => item.id).filter((id) =>
      connected.has(id),
    ),
    waves,
    waitFor,
    spawnNow,
    spawnParallel,
    spawnAfterThis,
    attached,
    layers,
    maxSubagents,
  }
}

function blueprintFile(dataDir) {
  return path.join(dataDir, 'blueprint.json')
}

function localBlueprintFile(dataDir, sessionId) {
  return sessionPaths(dataDir, sessionId).blueprint
}

export function findSessionIdByColor(dataDir, colorId) {
  const color = resolveSessionColor(colorId)
  if (!color) return null
  const direct = readManifest(dataDir, color.id)
  if (direct && !isTerminalSession(direct)) return color.id
  for (const sessionId of listOpenSessionIds(dataDir)) {
    const assigned = resolveSessionColor(readManifest(dataDir, sessionId)?.color)
    if (assigned?.id === color.id) return sessionId
  }
  return null
}

function resetLlmSessionWork(dataDir, sessionId, targetRoot = null) {
  const safeId = assertSessionId(sessionId)
  const manifest = readManifest(dataDir, safeId)
  if (!manifest || isTerminalSession(manifest)) return manifest
  // Keep live project files. Only clear stored session overlays / plan state.
  void targetRoot
  const paths = sessionPaths(dataDir, safeId)
  for (const dir of [paths.diffs, paths.preStep, paths.baselineFiles]) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  }
  for (const file of [
    paths.baseline,
    ackFile(dataDir, safeId),
    connectionFile(dataDir, safeId),
  ]) {
    if (fs.existsSync(file)) fs.unlinkSync(file)
  }
  writeManifest(dataDir, {
    ...manifest,
    name: '',
    feature: '',
    steps: [],
    deliveries: [],
    currentDelivery: 0,
    status: 'active',
    phase: 'blueprint',
    awaitingAttach: true,
    currentStep: 1,
    activeDiffId: null,
    pendingInstruction: null,
    pendingExplain: false,
    workStartedAt: null,
    diffs: [],
  })
  return readManifest(dataDir, safeId)
}

function recycleColorSlotForAttach(dataDir, color, targetRoot = null) {
  const matchId = findSessionIdByColor(dataDir, color.id)
  if (!matchId) throw new Error(colorMissingMessage(color.name))
  resetLlmSessionWork(dataDir, matchId, targetRoot)
  return matchId
}

function blueprintHasContent(blueprint) {
  return (
    (blueprint.files?.length ?? 0) > 0 ||
    (blueprint.folders?.length ?? 0) > 0 ||
    (blueprint.addedFunctions?.length ?? 0) > 0 ||
    (blueprint.addedVariables?.length ?? 0) > 0 ||
    (blueprint.addedImports?.length ?? 0) > 0 ||
    (blueprint.notes?.length ?? 0) > 0 ||
    (blueprint.pointers?.length ?? 0) > 0
  )
}

function normalizeContextFiles(value) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const storedName =
      typeof item.storedName === 'string' ? item.storedName.trim() : ''
    const size = item.size
    if (!id || !name || !storedName || !Number.isFinite(size) || size < 0) {
      return []
    }
    if (storedName.includes('..') || path.basename(storedName) !== storedName) {
      return []
    }
    return [
      {
        id,
        name,
        storedName,
        mimeType:
          typeof item.mimeType === 'string' && item.mimeType.trim()
            ? item.mimeType.trim()
            : 'application/octet-stream',
        size,
      },
    ]
  })
}

function safeContextFileName(name) {
  const base = path.basename(String(name || 'file')).replace(/[\u0000-\u001f]/g, '')
  const cleaned = base
    .replace(/[^\w.\- ()[\]]+/g, '_')
    .replace(/^\.+/, '')
    .trim()
  return (cleaned || 'file').slice(0, 120)
}

function decodeContextFileBytes(file) {
  if (Buffer.isBuffer(file?.bytes)) return file.bytes
  if (typeof file?.contentBase64 === 'string' && file.contentBase64.trim()) {
    if (!/^[A-Za-z0-9+/=\s]+$/.test(file.contentBase64)) {
      throw new Error('context file content must be base64')
    }
    return Buffer.from(file.contentBase64, 'base64')
  }
  throw new Error('context file bytes are required')
}

function contextFileAbsolute(dir, storedName) {
  const absolute = path.resolve(dir, storedName)
  const prefix = dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`
  if (absolute !== dir && !absolute.startsWith(prefix)) {
    throw new Error(`Invalid context file path ${storedName}`)
  }
  return absolute
}

function publicContextFile(item) {
  return {
    id: item.id,
    name: item.name,
    mimeType: item.mimeType,
    size: item.size,
  }
}

function isInlineContextText(mimeType, bytes) {
  if (bytes.length === 0 || bytes.length > CONTEXT_TEXT_INLINE_BYTES) return false
  if (bytes.includes(0)) return false
  const mime = typeof mimeType === 'string' ? mimeType.toLowerCase() : ''
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return false
  if (mime === 'application/pdf' || mime === 'application/zip') return false
  if (mime.startsWith('image/') && mime !== 'image/svg+xml') return false
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/javascript' ||
    mime === 'application/xml' ||
    mime === 'image/svg+xml' ||
    mime === 'application/octet-stream' ||
    mime === ''
  ) {
    return true
  }
  return !mime.startsWith('image/')
}

export function listContextFiles(dataDir, sessionId) {
  const manifest = requireManifest(dataDir, sessionId)
  const dir = sessionPaths(dataDir, sessionId).context
  return normalizeContextFiles(manifest.contextFiles).flatMap((item) => {
    let absolute
    try {
      absolute = contextFileAbsolute(dir, item.storedName)
    } catch {
      return []
    }
    if (!fs.existsSync(absolute)) return []
    return [{ ...item, path: absolute }]
  })
}

export function contextFileHandshake(dataDir, sessionId) {
  const files = listContextFiles(dataDir, sessionId)
  const listed = []
  const texts = []
  for (const file of files) {
    listed.push({
      name: file.name,
      path: file.path,
      mimeType: file.mimeType,
      size: file.size,
    })
    const bytes = fs.readFileSync(file.path)
    if (isInlineContextText(file.mimeType, bytes)) {
      texts.push({ name: file.name, content: bytes.toString('utf8') })
    }
  }
  return { files: listed, texts }
}

export function readManifest(dataDir, sessionId) {
  const { manifest } = sessionPaths(dataDir, sessionId)
  const value = readJson(manifest, null)
  if (!value || value.sessionId !== sessionId || !Array.isArray(value.diffs)) return null
  if (!value.phase) {
    const active = value.diffs.at(-1)
    value.phase =
      value.status === 'finished'
        ? 'finished'
        : value.status === 'rejected'
          ? 'stopped'
          : active?.status === 'pending'
            ? 'review'
            : active?.status === 'extend'
              ? 'replanning'
              : 'plan_ready'
    value.currentStep =
      value.currentStep ??
      (active?.status === 'applied' ? active.step + 1 : active?.step ?? 1)
    value.pendingInstruction ??= null
    value.workStartedAt ??= null
  }
  if (typeof value.pendingExplain !== 'boolean') value.pendingExplain = false
  value.deliveries = Array.isArray(value.deliveries) ? value.deliveries : []
  if (!Number.isInteger(value.currentDelivery) || value.currentDelivery < 0) {
    value.currentDelivery = value.deliveries.length > 0 ? 1 : 0
  }
  value.steps = Array.isArray(value.steps)
    ? value.steps.map((step) => ({
        ...step,
        id: stepIdOf(step),
      }))
    : []
  value.currentStepIds = normalizeCurrentStepIds(value)
  delete value.stepByStep
  value.initialInstruction =
    typeof value.initialInstruction === 'string' ? value.initialInstruction : null
  value.contextFiles = normalizeContextFiles(value.contextFiles)
  return value
}

export function writeManifest(dataDir, manifest) {
  const safeId = assertSessionWritable(dataDir, manifest.sessionId)
  const paths = sessionPaths(dataDir, safeId)
  manifest.updatedAt = new Date().toISOString()
  atomicWrite(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`)
}

export function readOverlay(dataDir, sessionId, entry) {
  const paths = sessionPaths(dataDir, sessionId)
  const absolute = path.resolve(paths.root, entry.file)
  if (!absolute.startsWith(`${paths.root}${path.sep}`)) {
    throw new Error(`Invalid diff path for ${entry.id}`)
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    return emptyChangeOverlay()
  }
  const raw = fs.readFileSync(absolute, 'utf8')
  if (entry.file.endsWith('.patch')) return overlayFromPatchText(raw)
  try {
    return normalizeChangeOverlay(JSON.parse(raw))
  } catch {
    return overlayFromPatchText(raw)
  }
}

function entryIndex(manifest, diffId) {
  const index = manifest.diffs.findIndex((entry) => entry.id === diffId)
  if (index < 0) throw new Error(`Unknown diff ${diffId}`)
  return index
}

export function chainThrough(manifest, diffId = manifest.activeDiffId) {
  if (!diffId) return []
  return manifest.diffs.slice(0, entryIndex(manifest, diffId) + 1)
}

function liveEntries(manifest, diffId) {
  const chain = chainThrough(manifest, diffId)
  if (chain.length === 0) return []
  const selected = chain.at(-1)
  const browsingHistory = selected.id !== manifest.activeDiffId
  return chain.filter((entry) => {
    if (entry.status === 'rejected') return false
    if (entry.status === 'extended') {
      return browsingHistory && entry.id === selected.id
    }
    if (entry.status === 'extend') {
      return entry.id === selected.id
    }
    return true
  })
}

function unresolvedEntries(manifest, diffId = manifest.activeDiffId) {
  return liveEntries(manifest, diffId).filter((entry) => entry.status !== 'applied')
}

function readCodebaseFileIds(dataDir) {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'codebase.json'), 'utf8'),
    )
    return Array.isArray(parsed?.files)
      ? parsed.files
          .map((file) => file?.id)
          .filter((id) => typeof id === 'string' && id)
      : []
  } catch {
    return []
  }
}

function captureChangeOverlay(dataDir, sessionId, targetRoot, knownFileIds) {
  if (hasGitRepo(targetRoot)) {
    const git = readWorkingTreeChanges(targetRoot, knownFileIds)
    if (overlayHasChanges(git)) return git
  }
  const patch = readLiveDiff(dataDir, sessionId, targetRoot)
  return overlayFromPatchText(patch, knownFileIds)
}

function overlayWithAbsentFiles(overlay, targetRoot, knownFileIds) {
  if (
    !targetRoot ||
    ((overlay?.files?.length ?? 0) === 0 &&
      (overlay?.creates?.length ?? 0) === 0 &&
      (overlay?.deletes?.length ?? 0) === 0)
  ) {
    return overlay
  }
  return withAbsentMappedFiles(overlay, targetRoot, knownFileIds)
}

function liveChangeOverlay(
  dataDir,
  sessionId,
  targetRoot,
  knownFileIds,
  stored,
) {
  if (!targetRoot) return stored
  if (hasGitRepo(targetRoot)) {
    const git = readWorkingTreeChanges(targetRoot, knownFileIds)
    if (overlayHasChanges(git)) return mergeChangeNotes(git, stored)
    return stored
  }
  try {
    return mergeChangeNotes(
      captureChangeOverlay(dataDir, sessionId, targetRoot, knownFileIds),
      stored,
    )
  } catch {
    return stored
  }
}

export function sessionIntent(
  dataDir,
  sessionId,
  knownFileIds = [],
  selectedDiffId,
  waiterIds = waiterSessionIds(),
  targetRoot = null,
) {
  const manifest = readManifest(dataDir, sessionId)
  if (!manifest) return null
  const selectedId = selectedDiffId || manifest.activeDiffId
  const selectedIndex = selectedId ? entryIndex(manifest, selectedId) : null
  const selected =
    selectedIndex === null ? null : manifest.diffs[selectedIndex]
  const stored = selected
    ? readOverlay(dataDir, sessionId, selected)
    : emptyChangeOverlay()
  const browsingHistory = Boolean(
    selectedDiffId && selected && selected.id !== manifest.activeDiffId,
  )
  const preview = overlayWithAbsentFiles(
    dropMassKnownCreates(
      browsingHistory || !isChatLocked(dataDir, sessionId)
        ? stored
        : liveChangeOverlay(dataDir, sessionId, targetRoot, knownFileIds, stored),
      knownFileIds,
    ),
    targetRoot,
    knownFileIds,
  )
  const previewVisible = overlayHasChanges(preview) || Boolean(selected)
  const activeView = !selectedDiffId || selectedId === manifest.activeDiffId
  const phaseStatus = {
    blueprint_ask: 'blueprint_ask',
    blueprint: 'blueprint',
    preparing: 'preparing',
    plan_ready: 'planned',
    working: 'working',
    review: 'pending',
    replanning: 'replanning',
    finished: 'finished',
    stopped: 'rejected',
  }[manifest.phase]
  const historicalStatus =
    selected?.status === 'applied'
      ? 'approved'
      : selected?.status ?? phaseStatus ?? 'idle'
  const currentPlanStep = manifest.steps.find(
    (step) => step.index === manifest.currentStep,
  )
  const blueprint = readLocalBlueprint(dataDir, sessionId)
  const canEnterBlueprint = manifest.phase === 'blueprint_ask'
  const colored = ensureManifestColor(dataDir, manifest)
  const color = resolveSessionColor(colored.color)

  return {
    updatedAt: colored.updatedAt,
    showMap: previewVisible,
    status: activeView ? phaseStatus ?? historicalStatus : historicalStatus,
    phase: colored.phase,
    name: resolvedSessionName(colored) || null,
    color: color?.id ?? null,
    colorName: color?.name ?? null,
    colorHex: color?.hex ?? null,
    feature: manifest.feature,
    initialInstruction:
      typeof manifest.initialInstruction === 'string'
        ? manifest.initialInstruction
        : null,
    contextFiles: listContextFiles(dataDir, sessionId).map(publicContextFile),
    deliveries: manifest.deliveries ?? [],
    currentDelivery: manifest.currentDelivery ?? 0,
    steps: manifest.steps,
    step: activeView ? manifest.currentStep : selected?.step ?? manifest.currentStep,
    reason: activeView ? currentPlanStep?.title ?? null : selected?.title ?? null,
    sessionId,
    diffId: selected?.id ?? null,
    parentDiffId: selected?.parentId ?? null,
    chainIndex: selectedIndex,
    chain: manifest.diffs.map((entry, index) => {
      const overlay = overlayWithAbsentFiles(
        readOverlay(dataDir, sessionId, entry),
        targetRoot,
        knownFileIds,
      )
      return {
        id: entry.id,
        index,
        step: entry.step,
        title: entry.title,
        status: entry.status,
        files: overlay.files,
        creates: overlay.creates,
        deletes: overlay.deletes,
        absent: overlay.absent,
        createFolders: overlay.createFolders,
        createLines: overlay.createLines,
        imports: overlay.imports,
        addedFunctions: overlay.addedFunctions,
        addedVariables: overlay.addedVariables,
        addedImports: overlay.addedImports,
        changedFunctions: overlay.changedFunctions,
        changedVariables: overlay.changedVariables,
        changeNotes: overlay.changeNotes,
      }
    }),
    isActiveDiff: Boolean(selected && selected.id === manifest.activeDiffId),
    liveStep: manifest.currentStep,
    activeSteps: (manifest.steps ?? [])
      .filter((item) => normalizeCurrentStepIds(manifest).includes(stepIdOf(item)))
      .map((item) => item.index),
    preview: previewVisible,
    working:
      isChatLocked(dataDir, sessionId) &&
      (manifest.phase === 'preparing' ||
        manifest.phase === 'working' ||
        manifest.phase === 'replanning'),
    stalledWait: isStalledWorking(manifest, waiterIds, sessionId),
    llmIdle: !isSessionConnected(dataDir, sessionId, waiterIds),
    awaitingAttach: !isChatLocked(dataDir, sessionId),
    listening: waiterIds.has(sessionId),
    lastAck: readSessionAck(dataDir, sessionId),
    pendingExplain: Boolean(manifest.pendingExplain),
    explainActive: Boolean(readExplain(dataDir).active),
    creationMode: true,
    canEnterBlueprint,
    blueprintHidden: Boolean(blueprint.hidden),
    blueprintRevision: blueprint.revision,
    blueprintSessionId: null,
    localBlueprintEnabled: readLocalBlueprint(dataDir, sessionId).enabled,
    userCreatedBlocks: blueprint.files,
    userCreatedIslands: blueprint.folders,
    ...preview,
    blueprintFunctions: blueprint.addedFunctions,
    blueprintVariables: blueprint.addedVariables,
    blueprintImports: blueprint.addedImports,
    blueprintNotes: blueprint.notes,
    blueprintPointers: blueprint.pointers,
    dependsOn: blueprint.dependsOn,
  }
}

function emptyBaseline() {
  return { files: {} }
}

function readBaseline(dataDir, sessionId) {
  const { baseline } = sessionPaths(dataDir, sessionId)
  const value = readJson(baseline, emptyBaseline())
  return {
    files:
      value?.files && typeof value.files === 'object' && !Array.isArray(value.files)
        ? value.files
        : {},
  }
}

function writeBaseline(dataDir, sessionId, baseline) {
  const { baseline: file } = sessionPaths(dataDir, sessionId)
  atomicWrite(file, `${JSON.stringify({ files: baseline.files ?? {} }, null, 2)}\n`)
}

function pruneEmptyDirs(targetRoot, filePath) {
  const root = path.resolve(targetRoot)
  let current = path.dirname(filePath)
  while (current.startsWith(`${root}${path.sep}`)) {
    if (!fs.existsSync(current)) {
      current = path.dirname(current)
      continue
    }
    if (fs.readdirSync(current).length > 0) break
    fs.rmdirSync(current)
    current = path.dirname(current)
  }
}

export function captureBaseline(dataDir, sessionId, targetRoot, fileIds = []) {
  const paths = sessionPaths(dataDir, sessionId)
  const baseline = readBaseline(dataDir, sessionId)
  let changed = false
  for (const fileId of fileIds) {
    const { id, absolute } = resolveTargetFile(targetRoot, fileId)
    if (baseline.files[id]) continue
    const existed = fs.existsSync(absolute) && fs.statSync(absolute).isFile()
    baseline.files[id] = { existed }
    if (existed) {
      const stored = resolveTargetFile(paths.baselineFiles, id).absolute
      fs.mkdirSync(path.dirname(stored), { recursive: true })
      fs.copyFileSync(absolute, stored)
    }
    changed = true
  }
  if (changed) writeBaseline(dataDir, sessionId, baseline)
  return baseline
}

export function restoreBaseline(dataDir, sessionId, targetRoot) {
  const paths = sessionPaths(dataDir, sessionId)
  const baseline = readBaseline(dataDir, sessionId)
  for (const [fileId, info] of Object.entries(baseline.files)) {
    const { absolute } = resolveTargetFile(targetRoot, fileId)
    if (!info?.existed) {
      fs.rmSync(absolute, { force: true })
      pruneEmptyDirs(targetRoot, absolute)
      continue
    }
    const stored = resolveTargetFile(paths.baselineFiles, fileId).absolute
    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    fs.copyFileSync(stored, absolute)
  }
}

function restoreSessionFiles(dataDir, sessionId, targetRoot) {
  const extraAbsolutes = []
  const { preStep } = sessionPaths(dataDir, sessionId)
  if (fs.existsSync(preStep)) {
    for (const fileId of restoreSourceTree(preStep, targetRoot, dataDir)) {
      try {
        extraAbsolutes.push(resolveTargetFile(targetRoot, fileId).absolute)
      } catch {
        // Ignore ids the scanner would also skip.
      }
    }
  }
  restoreBaseline(dataDir, sessionId, targetRoot)
  unstagePaths(targetRoot, extraAbsolutes)
}

function gitTopLevel(fromDir) {
  try {
    const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: fromDir,
      encoding: 'utf8',
    })
    if (result.status !== 0) return null
    const root = result.stdout.trim()
    return root ? fs.realpathSync(root) : null
  } catch {
    return null
  }
}

function repoRelativePath(root, absolutePath) {
  const resolved = path.resolve(absolutePath)
  let candidate = resolved
  try {
    if (fs.existsSync(resolved)) candidate = fs.realpathSync(resolved)
    else if (fs.existsSync(path.dirname(resolved))) {
      candidate = path.join(fs.realpathSync(path.dirname(resolved)), path.basename(resolved))
    }
  } catch {
    candidate = resolved
  }
  const relative = path.relative(root, candidate)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return relative
}

function unstagePaths(fromDir, absolutePaths) {
  if (!absolutePaths.length) return
  const root = gitTopLevel(fromDir)
  if (!root) return
  const relative = [...new Set(absolutePaths)]
    .map((item) => repoRelativePath(root, item))
    .filter((item) => Boolean(item))
  if (!relative.length) return
  for (const item of relative) {
    spawnSync('git', ['restore', '--staged', '--', item], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'ignore',
    })
  }
}

export function materializeDiff(dataDir, _targetRoot, sessionId) {
  return requireManifest(dataDir, sessionId)
}

export function inspectTargetFile(
  _dataDir,
  targetRoot,
  { fileId } = {},
) {
  if (!fileId) return null
  const { absolute } = resolveTargetFile(targetRoot, fileId)
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error(`File ${fileId} is not on disk`)
  }
  return absolute
}

function planNamedItems(titles, emptyMessage, emptyTitleMessage, startAt = 1) {
  if (!Array.isArray(titles) || titles.length === 0) {
    throw new Error(emptyMessage)
  }
  return titles.map((title, offset) => {
    const trimmed = typeof title === 'string' ? title.trim() : ''
    if (!trimmed) throw new Error(emptyTitleMessage)
    return { index: startAt + offset, title: trimmed }
  })
}

function planSteps(titles, startAt = 1, delivery = null) {
  return planLabeledSteps(titles, startAt, delivery)
}

function normalizeCurrentStepIds(manifest) {
  if (Array.isArray(manifest.currentStepIds) && manifest.currentStepIds.length > 0) {
    return manifest.currentStepIds.map((id) => String(id))
  }
  const current = (manifest.steps ?? []).find(
    (step) => step.index === manifest.currentStep,
  )
  return current ? [stepIdOf(current)] : []
}

function completedStepIds(manifest) {
  const ids = new Set()
  const byIndex = new Map(
    (manifest.steps ?? []).map((step) => [step.index, stepIdOf(step)]),
  )
  for (const entry of manifest.diffs ?? []) {
    if (
      entry.status !== 'applied' &&
      entry.status !== 'pending' &&
      entry.status !== 'extend' &&
      entry.status !== 'extended'
    ) {
      continue
    }
    const id =
      typeof entry.stepId === 'string' && entry.stepId.trim()
        ? entry.stepId.trim()
        : byIndex.get(entry.step)
    if (id) ids.add(id)
  }
  return ids
}

function resolvePlanStep(manifest, stepRef) {
  const steps = manifest.steps ?? []
  if (stepRef == null || stepRef === '') {
    const currentId = normalizeCurrentStepIds(manifest)[0]
    return (
      steps.find((step) => stepIdOf(step) === currentId) ??
      steps.find((step) => step.index === manifest.currentStep) ??
      null
    )
  }
  const raw = String(stepRef).trim()
  const byId = steps.find(
    (step) => stepIdOf(step).toUpperCase() === raw.toUpperCase(),
  )
  if (byId) return byId
  const index = Number(raw)
  if (Number.isInteger(index)) {
    return steps.find((step) => step.index === index) ?? null
  }
  return null
}

function syncCurrentStep(manifest, stepIds) {
  const ids = [...new Set((stepIds ?? []).map((id) => String(id)).filter(Boolean))]
  manifest.currentStepIds = ids
  const first = (manifest.steps ?? []).find((step) => ids.includes(stepIdOf(step)))
  if (first) manifest.currentStep = first.index
  return ids
}

function invokeReadyOnManifest(manifest, maxSubagents = 4) {
  const completed = completedStepIds(manifest)
  const current =
    manifest.phase === 'plan_ready' ? [] : normalizeCurrentStepIds(manifest)
  const next = nextInvokedStepIds(
    manifest.steps,
    completed,
    current,
    maxSubagents,
  )
  return syncCurrentStep(manifest, next)
}

function planDeliveries(titles) {
  return planNamedItems(
    titles,
    'At least one delivery is required',
    'Delivery titles cannot be empty',
  )
}

function hasDeliveries(manifest) {
  return Array.isArray(manifest?.deliveries) && manifest.deliveries.length > 0
}

function currentDeliveryIndex(manifest) {
  if (!hasDeliveries(manifest)) return 0
  return Number.isInteger(manifest.currentDelivery) && manifest.currentDelivery > 0
    ? manifest.currentDelivery
    : 1
}

function hasLaterDelivery(manifest) {
  return hasDeliveries(manifest) && currentDeliveryIndex(manifest) < manifest.deliveries.length
}

function pendingReviewDiff(manifest) {
  if (manifest?.phase !== 'review') return null
  const active =
    manifest.diffs.find(
      (entry) =>
        entry.id === manifest.activeDiffId && entry.status === 'pending',
    ) || manifest.diffs.at(-1)
  return active?.status === 'pending' ? active : null
}

function canRevisePlan(phase) {
  return (
    phase === 'replanning' ||
    phase === 'review' ||
    phase === 'plan_ready' ||
    phase === 'working'
  )
}

export function autoAdvance(dataDir, sessionId, targetRoot = null, maxSubagents = 4) {
  const manifest = readManifest(dataDir, sessionId)
  if (!manifest) return manifest
  if (manifest.phase === 'plan_ready') {
    return invokeReadySteps(dataDir, sessionId, targetRoot, maxSubagents)
  }
  if (manifest.phase === 'review') {
    const active = manifest.diffs.at(-1)
    if (!active || active.status !== 'pending') return manifest
    if (active.step >= manifest.steps.length) return manifest
    return invokeStep(dataDir, sessionId, active.step + 1, targetRoot)
  }
  return manifest
}

export function invokeReadySteps(dataDir, sessionId, targetRoot = null, maxSubagents = 4) {
  const manifest = requireManifest(dataDir, sessionId)
  if (manifest.phase !== 'plan_ready' && manifest.phase !== 'working') {
    throw new Error(`Session ${sessionId} is not ready to invoke a step`)
  }
  const invoked = invokeReadyOnManifest(manifest, maxSubagents)
  if (invoked.length === 0) {
    throw new Error(`No plan steps are ready to invoke for session ${sessionId}`)
  }
  manifest.phase = 'working'
  manifest.workStartedAt = new Date().toISOString()
  writeManifest(dataDir, manifest)
  const labels = invoked.map((id) => {
    const step = manifest.steps.find((item) => stepIdOf(item) === id)
    return step?.title ? `${id} — ${step.title}` : id
  })
  recordSessionAck(
    dataDir,
    sessionId,
    'invoke',
    labels.length === 1 ? `step ${labels[0]}` : `steps ${labels.join('; ')}`,
  )
  if (targetRoot) snapshotPreStep(dataDir, sessionId, targetRoot)
  return readManifest(dataDir, sessionId) ?? manifest
}

export function startSession(dataDir, input) {
  const sessionId = resolveSessionId(input.sessionId)
  clearStoppedMarker(dataDir, sessionId)
  clearReleasedMarker(dataDir, sessionId)
  const existing = readManifest(dataDir, sessionId)
  const name = sessionName(input.name) || sessionName(input.feature)
  if (existing && sessionIsWaitingToAttach(existing) && resolveSessionColor(sessionId)) {
    throw sessionStoppedError(sessionId)
  }
  if (existing && !sessionIsWaitingToAttach(existing) && !isTerminalSession(existing)) {
    if (name && existing.name !== name) {
      existing.name = name
      writeManifest(dataDir, existing)
    }
    setChatLocked(dataDir, sessionId, true)
    focusSession(dataDir, sessionId)
    return existing
  }

  const now = new Date().toISOString()
  const manifest = {
    version: 2,
    sessionId,
    name,
    color: resolveSessionColor(sessionId)?.id ?? existing?.color ?? nextSessionColor(dataDir) ?? SESSION_COLORS[0].id,
    feature: featureName(input.feature) || name,
    steps: [],
    deliveries: [],
    currentDelivery: 0,
    status: 'active',
    phase: 'blueprint_ask',
    awaitingAttach: false,
    currentStep: 1,
    activeDiffId: null,
    pendingInstruction: null,
    pendingExplain: false,
    initialInstruction: null,
    contextFiles: [],
    workStartedAt: null,
    createdAt: now,
    updatedAt: now,
    diffs: [],
  }
  writeManifest(dataDir, manifest)
  setChatLocked(dataDir, sessionId, true)
  focusSession(dataDir, sessionId)
  return readManifest(dataDir, sessionId) ?? manifest
}

export function setupSession(dataDir, input = {}) {
  const sessionId = input.sessionId
    ? resolveSessionId(input.sessionId)
    : nextSessionColor(dataDir)
  if (!sessionId) {
    throw new Error(ALL_COLORS_LOCKED_MESSAGE)
  }
  const existing = readManifest(dataDir, sessionId)
  if (existing && !isTerminalSession(existing)) {
    throw new Error(`Session ${sessionId} already exists`)
  }
  if (!existing && listOpenSessionIds(dataDir).length >= SESSION_SLOT_COUNT) {
    throw new Error(ALL_COLORS_LOCKED_MESSAGE)
  }
  if (existing) {
    discardStoredSession(dataDir, sessionId, null, { restore: false })
  }
  clearStoppedMarker(dataDir, sessionId)
  clearReleasedMarker(dataDir, sessionId)
  const now = new Date().toISOString()
  const name = sessionName(input.name)
  const manifest = {
    version: 2,
    sessionId,
    name,
    color: resolveSessionColor(sessionId)?.id ?? nextSessionColor(dataDir) ?? SESSION_COLORS[0].id,
    feature: featureName(input.feature) || name,
    steps: [],
    deliveries: [],
    currentDelivery: 0,
    status: 'active',
    phase: 'blueprint',
    awaitingAttach: true,
    currentStep: 1,
    activeDiffId: null,
    pendingInstruction: null,
    pendingExplain: false,
    initialInstruction: null,
    contextFiles: [],
    workStartedAt: null,
    createdAt: now,
    updatedAt: now,
    diffs: [],
  }
  writeManifest(dataDir, manifest)
  setChatLocked(dataDir, sessionId, false)
  if (input.focus !== false) focusSession(dataDir, sessionId)
  return readManifest(dataDir, sessionId) ?? manifest
}

export function setInitialInstruction(dataDir, sessionId, instruction) {
  const manifest = requireManifest(dataDir, sessionId)
  if (isTerminalSession(manifest)) {
    throw sessionStoppedError(sessionId)
  }
  const text = typeof instruction === 'string' ? instruction : ''
  if (text.length > 4000) {
    throw new Error('instruction must be a string up to 4000 characters')
  }
  const next = text.trim() === '' ? null : text
  if ((manifest.initialInstruction ?? null) === next) return manifest
  manifest.initialInstruction = next
  writeManifest(dataDir, manifest)
  return manifest
}

export function addContextFiles(dataDir, sessionId, files) {
  const manifest = requireManifest(dataDir, sessionId)
  if (isTerminalSession(manifest)) {
    throw sessionStoppedError(sessionId)
  }
  const incoming = Array.isArray(files) ? files : files ? [files] : []
  if (incoming.length === 0) {
    throw new Error('at least one context file is required')
  }

  const existing = listContextFiles(dataDir, sessionId)
  if (existing.length + incoming.length > MAX_CONTEXT_FILES) {
    throw new Error(`at most ${MAX_CONTEXT_FILES} context files can be attached`)
  }

  const dir = sessionPaths(dataDir, sessionId).context
  fs.mkdirSync(dir, { recursive: true })
  const existingBytes = existing.reduce((sum, item) => sum + item.size, 0)
  const next = [...existing.map((item) => ({
    id: item.id,
    name: item.name,
    storedName: item.storedName,
    mimeType: item.mimeType,
    size: item.size,
  }))]
  let addedBytes = 0

  for (const file of incoming) {
    const bytes = decodeContextFileBytes(file)
    if (bytes.length === 0) {
      throw new Error('context file is empty')
    }
    if (bytes.length > MAX_CONTEXT_FILE_BYTES) {
      throw new Error(
        `context file must be ${MAX_CONTEXT_FILE_BYTES} bytes or smaller`,
      )
    }
    addedBytes += bytes.length
    if (existingBytes + addedBytes > MAX_CONTEXT_TOTAL_BYTES) {
      throw new Error(
        `attached files must total ${MAX_CONTEXT_TOTAL_BYTES} bytes or less`,
      )
    }
    const id = crypto.randomBytes(4).toString('hex')
    const originalName =
      typeof file?.name === 'string' ? path.basename(file.name.trim()) : ''
    const storedName = `${id}-${safeContextFileName(originalName || 'file')}`
    fs.writeFileSync(contextFileAbsolute(dir, storedName), bytes)
    next.push({
      id,
      name: originalName || storedName,
      storedName,
      mimeType:
        typeof file?.mimeType === 'string' && file.mimeType.trim()
          ? file.mimeType.trim()
          : 'application/octet-stream',
      size: bytes.length,
    })
  }

  manifest.contextFiles = next
  writeManifest(dataDir, manifest)
  return manifest
}

export function removeContextFile(dataDir, sessionId, fileId) {
  const manifest = requireManifest(dataDir, sessionId)
  if (isTerminalSession(manifest)) {
    throw sessionStoppedError(sessionId)
  }
  const id = typeof fileId === 'string' ? fileId.trim() : ''
  if (!id) throw new Error('fileId is required')
  const existing = normalizeContextFiles(manifest.contextFiles)
  const item = existing.find((file) => file.id === id)
  if (!item) return manifest
  const dir = sessionPaths(dataDir, sessionId).context
  try {
    fs.unlinkSync(contextFileAbsolute(dir, item.storedName))
  } catch {
    // Drop the manifest entry even if the file is already gone.
  }
  manifest.contextFiles = existing.filter((file) => file.id !== id)
  writeManifest(dataDir, manifest)
  return manifest
}

export function readAttachedSession(dataDir) {
  for (const sessionId of listOpenSessionIds(dataDir)) {
    if (isChatLocked(dataDir, sessionId)) return sessionId
  }
  return null
}

function resolveAttachSessionId(dataDir, sessionId, options = {}) {
  const targetRoot = options.targetRoot ?? null
  if (sessionId) {
    const safeId = resolveSessionId(sessionId)
    const existing = readManifest(dataDir, safeId)
    if (existing && !isTerminalSession(existing) && sessionIsWaitingToAttach(existing)) {
      resetLlmSessionWork(dataDir, safeId, targetRoot)
    }
    return safeId
  }
  if (options.color) {
    const color = parseSessionColorQuery(options.color)
    if (!color) throw new Error(colorUnknownMessage(options.color))
    return recycleColorSlotForAttach(dataDir, color, targetRoot)
  }
  if (options.first) {
    const colorId = firstHierarchyAttachColor(dataDir)
    if (!colorId) throw new Error(NO_HIERARCHY_BLUEPRINT_MESSAGE)
    const color = resolveSessionColor(colorId)
    if (!color) throw new Error(NO_HIERARCHY_BLUEPRINT_MESSAGE)
    return recycleColorSlotForAttach(dataDir, color, targetRoot)
  }
  const nextId = nextAttachSessionId(dataDir)
  if (nextId) resetLlmSessionWork(dataDir, nextId, targetRoot)
  return nextId
}

export function attachSession(dataDir, sessionId, options = {}) {
  const explicitSession = Boolean(sessionId)
  const safeId = resolveAttachSessionId(dataDir, sessionId, options)
  if (!safeId) {
    throw new Error(ALL_COLORS_LOCKED_MESSAGE)
  }
  const manifest = requireManifest(
    dataDir,
    safeId,
    `No Inbase session ${safeId} is waiting to connect.`,
  )
  if (isTerminalSession(manifest)) {
    throw sessionStoppedError(safeId)
  }
  const alreadyAttached = explicitSession && !sessionIsWaitingToAttach(manifest)
  focusSession(dataDir, safeId)
  setChatLocked(dataDir, safeId, true)
  touchSessionConnection(dataDir, safeId)
  const colored = ensureManifestColor(dataDir, readManifest(dataDir, safeId) ?? manifest)
  const colorName = resolveSessionColor(colored.color)?.name
  if (!alreadyAttached) {
    recordSessionAck(
      dataDir,
      safeId,
      'attached',
      colorName || resolvedSessionName(colored) || safeId,
    )
  }
  maybeStartVisualizerHandshake(dataDir, safeId)
  return readManifest(dataDir, safeId) ?? colored
}

export function answerBlueprint(dataDir, sessionId, enabled) {
  const manifest = requireManifest(dataDir, sessionId)
  if (manifest.phase !== 'blueprint_ask') {
    throw new Error(`Session ${sessionId} is not asking for a blueprint`)
  }
  manifest.phase = enabled ? 'blueprint' : 'preparing'
  if (!enabled) manifest.workStartedAt = new Date().toISOString()
  writeManifest(dataDir, manifest)
  return manifest
}

export function updateBlueprint(dataDir, sessionId, input = {}) {
  const colorId =
    input.color ||
    (sessionId ? readManifest(dataDir, sessionId)?.color : null) ||
    DEFAULT_SESSION_COLOR.id
  const fields = blueprintInputFields(input)
  const current = readBlueprintByColor(dataDir, colorId)
  const next = {
    ...current,
    files: fields.files ?? fields.userCreatedBlocks ?? current.files,
    folders: fields.folders ?? fields.userCreatedIslands ?? current.folders,
    addedFunctions: fields.addedFunctions ?? current.addedFunctions,
    addedVariables: fields.addedVariables ?? current.addedVariables,
    addedImports: fields.addedImports ?? current.addedImports,
    notes: fields.notes ?? current.notes,
    pointers: fields.pointers ?? current.pointers,
    dependsOn:
      fields.dependsOn !== undefined ? fields.dependsOn : current.dependsOn,
  }
  return writeBlueprintByColor(dataDir, colorId, next)
}

export function sendBlueprint(dataDir, sessionId, _input = {}) {
  const safeId = assertSessionId(sessionId)
  const manifest = requireManifest(dataDir, safeId)
  if (manifest.phase !== 'blueprint') {
    throw new Error(`Session ${safeId} is not in blueprint mode`)
  }
  manifest.phase = 'preparing'
  manifest.workStartedAt = new Date().toISOString()
  writeManifest(dataDir, manifest)
  return manifest
}

export function maybeStartVisualizerHandshake(dataDir, sessionId) {
  const safeId = assertSessionId(sessionId)
  const manifest = requireManifest(dataDir, safeId)
  if (sessionIsWaitingToAttach(manifest) || !isChatLocked(dataDir, safeId)) {
    return manifest
  }
  if (manifest.phase !== 'blueprint_ask' && manifest.phase !== 'blueprint') {
    return manifest
  }
  manifest.phase = 'preparing'
  manifest.workStartedAt = new Date().toISOString()
  writeManifest(dataDir, manifest)
  return manifest
}

function requireWritableSession(dataDir, sessionId) {
  const existing = readManifest(dataDir, sessionId)
  if (!existing && isSessionStopped(dataDir, sessionId)) {
    throw sessionStoppedError(sessionId)
  }
  if (!existing && isSessionReleased(dataDir, sessionId)) {
    throw sessionMissingError(sessionId)
  }
  if (
    (existing && sessionIsWaitingToAttach(existing)) ||
    (resolveSessionColor(sessionId) && !isChatLocked(dataDir, sessionId))
  ) {
    throw sessionStoppedError(sessionId)
  }
  if (existing?.phase === 'blueprint_ask' || existing?.phase === 'blueprint') {
    throw new Error(
      `Session ${sessionId} is waiting for the user to finish the blueprint handshake`,
    )
  }
  return existing
}

function assignPlanSteps(manifest, stepTitles, startAt = 1) {
  const delivery = currentDeliveryIndex(manifest) || null
  const kept = delivery
    ? (manifest.steps ?? []).filter((step) => (step.delivery ?? 0) < delivery)
    : []
  const from = kept.length ? kept.at(-1).index + 1 : startAt
  manifest.steps = [...kept, ...planSteps(stepTitles, from, delivery)]
  if (delivery && from !== manifest.currentStep) {
    manifest.currentStep = from
  }
  return manifest.steps.filter((step) => step.index >= from)
}

export function reportDeliveries(dataDir, input) {
  const sessionId = resolveSessionId(input.sessionId)
  const existing = requireWritableSession(dataDir, sessionId)
  const now = new Date().toISOString()

  if (existing && existing.phase !== 'preparing') {
    throw new Error(
      `Session ${sessionId} is not waiting for deliveries. Report-plan for the invoked delivery.`,
    )
  }
  if (existing?.steps?.length) {
    throw new Error(
      `Deliveries already recorded for session ${sessionId}. Report-plan for delivery ${currentDeliveryIndex(existing)}.`,
    )
  }

  const manifest = existing ?? {
    version: 2,
    sessionId,
    name: sessionName(input.name) || sessionName(input.feature),
    feature: input.feature,
    steps: [],
    deliveries: [],
    currentDelivery: 0,
    status: 'active',
    phase: 'preparing',
    currentStep: 1,
    activeDiffId: null,
    pendingInstruction: null,
    initialInstruction: null,
    contextFiles: [],
    workStartedAt: null,
    createdAt: now,
    updatedAt: now,
    diffs: [],
  }
  if (!sessionName(manifest.name)) {
    manifest.name = sessionName(input.feature)
  }
  if (input.feature) manifest.feature = input.feature
  manifest.deliveries = planDeliveries(input.deliveryTitles)
  manifest.currentDelivery = 1
  manifest.status = 'active'
  manifest.phase = 'preparing'
  manifest.pendingInstruction = null
  manifest.workStartedAt = now
  writeManifest(dataDir, manifest)
  focusSession(dataDir, sessionId)
  const first = manifest.deliveries[0]
  recordSessionAck(
    dataDir,
    sessionId,
    'deliveries',
    first ? `delivery ${first.index} — ${first.title}` : `${manifest.deliveries.length} delivery(s)`,
  )
  return readManifest(dataDir, sessionId) ?? manifest
}

export function reportPlan(dataDir, input) {
  const sessionId = resolveSessionId(input.sessionId)
  const existing = requireWritableSession(dataDir, sessionId)
  const now = new Date().toISOString()

  if (!existing || existing.phase === 'preparing') {
    const manifest = existing ?? {
      version: 2,
      sessionId,
      name: sessionName(input.name) || sessionName(input.feature),
      feature: input.feature,
      steps: [],
      deliveries: [],
      currentDelivery: 0,
      status: 'active',
      phase: 'preparing',
      currentStep: 1,
      activeDiffId: null,
      pendingInstruction: null,
      initialInstruction: null,
      contextFiles: [],
      workStartedAt: null,
      createdAt: now,
      updatedAt: now,
      diffs: [],
    }
    if (!sessionName(manifest.name)) {
      manifest.name = sessionName(input.feature)
    }
    if (input.feature) manifest.feature = input.feature
    const planned = assignPlanSteps(manifest, input.stepTitles)
    manifest.status = 'active'
    manifest.phase = 'plan_ready'
    manifest.pendingInstruction = null
    manifest.workStartedAt = null
    writeManifest(dataDir, manifest)
    focusSession(dataDir, sessionId)
    recordSessionAck(
      dataDir,
      sessionId,
      'plan',
      `${planned.length} step(s)`,
    )
    return autoAdvance(dataDir, sessionId, input.targetRoot, input.maxSubagents)
  }

  if (!canRevisePlan(existing.phase)) {
    throw new Error(`Session ${sessionId} is not waiting for a revised plan`)
  }

  const pending = pendingReviewDiff(existing)
  const startAt = pending?.step ?? existing.currentStep
  const wasWorking = existing.phase === 'working'
  if (pending) {
    pending.status = 'extend'
    existing.currentStep = pending.step
    existing.activeDiffId = pending.id
  }
  if (input.feature) existing.feature = input.feature
  const delivery = currentDeliveryIndex(existing) || null
  existing.steps = [
    ...existing.steps.filter((step) => step.index < startAt),
    ...planSteps(input.stepTitles, startAt, delivery),
  ]
  existing.status = 'active'
  existing.pendingInstruction = null

  const remaining = existing.steps.filter((step) => step.index >= startAt)
  const title = remaining[0]?.title
  const remainingId = remaining[0] ? stepIdOf(remaining[0]) : String(startAt)
  if (pending) {
    // Reuse the invoke snapshot so the next propose-patch replaces this proposal.
    existing.phase = 'working'
    existing.workStartedAt = new Date().toISOString()
    syncCurrentStep(existing, remaining[0] ? [remainingId] : [])
    writeManifest(dataDir, existing)
    focusSession(dataDir, sessionId)
    recordSessionAck(dataDir, sessionId, 'plan', `${remaining.length} step(s)`)
    recordSessionAck(
      dataDir,
      sessionId,
      'invoke',
      title ? `step ${remainingId} — ${title}` : `step ${remainingId}`,
    )
    return existing
  }

  if (wasWorking) {
    writeManifest(dataDir, existing)
    focusSession(dataDir, sessionId)
    recordSessionAck(dataDir, sessionId, 'plan', `${remaining.length} step(s)`)
    return existing
  }

  existing.phase = 'plan_ready'
  existing.workStartedAt = null
  writeManifest(dataDir, existing)
  focusSession(dataDir, sessionId)
  recordSessionAck(dataDir, sessionId, 'plan', `${remaining.length} step(s)`)
  return autoAdvance(dataDir, sessionId, input.targetRoot, input.maxSubagents)
}

export function invokeStep(dataDir, sessionId, step, targetRoot = null) {
  const manifest = requireManifest(dataDir, sessionId)

  if (manifest.phase === 'review') {
    if (!targetRoot) throw new Error('A target root is required to apply the current step')
    const active = pendingActive(manifest, manifest.activeDiffId)
    const last = active.step >= manifest.steps.length
    const expected = last ? active.step : active.step + 1
    if (step !== expected) {
      throw new Error(
        last
          ? `The last proposal is waiting. Click Done in the session window to finish.`
          : `Step ${active.step} is already recorded.`,
      )
    }
    return continueDiff(dataDir, targetRoot, sessionId, active.id)
  }

  if (manifest.phase !== 'plan_ready') {
    throw new Error(`Session ${sessionId} is not ready to invoke a step`)
  }
  const planned = resolvePlanStep(manifest, step)
  if (!planned) {
    throw new Error(`Step ${step} is not the current plan step`)
  }
  syncCurrentStep(manifest, [stepIdOf(planned)])
  manifest.currentStep = planned.index
  manifest.phase = 'working'
  manifest.workStartedAt = new Date().toISOString()
  writeManifest(dataDir, manifest)
  const title = planned.title
  recordSessionAck(
    dataDir,
    sessionId,
    'invoke',
    title ? `step ${stepIdOf(planned)} — ${title}` : `step ${stepIdOf(planned)}`,
  )
  if (targetRoot) snapshotPreStep(dataDir, sessionId, targetRoot)
  return manifest
}

export function snapshotPreStep(dataDir, sessionId, targetRoot) {
  const { preStep } = sessionPaths(dataDir, sessionId)
  if (!fs.existsSync(preStep)) {
    snapshotSourceTree(targetRoot, preStep, dataDir)
  }
  return preStep
}

export function readLiveDiff(dataDir, sessionId, targetRoot) {
  const { preStep } = sessionPaths(dataDir, sessionId)
  if (!fs.existsSync(preStep)) {
    throw new Error(
      `Step ${sessionId} has no invoke snapshot. Wait for VISUAL_CODER_EXECUTE before recording file changes.`,
    )
  }
  return diffSourceTrees(preStep, targetRoot, dataDir, readCodebaseFileIds(dataDir))
}

export function appendDiff(dataDir, targetRoot, input) {
  const sessionId = assertSessionId(input.sessionId)
  const manifest = requireManifest(
    dataDir,
    sessionId,
    `Report a plan for session ${sessionId} first`,
  )
  if (manifest.phase === 'review') {
    throw new Error(
      `A proposal is waiting on step ${manifest.currentStep}. If the user asked for a change, run report-plan with the new remaining steps first — that replaces this proposal from step ${manifest.currentStep}. Do not edit files first. Then implement the invoked step and propose-patch.`,
    )
  }
  if (manifest.phase !== 'working') {
    throw new Error(
      manifest.phase === 'plan_ready'
        ? `Step ${manifest.currentStep} has not been invoked. If the user asked for a change, run report-plan with the new remaining steps first.`
        : `Step ${manifest.currentStep} has not been invoked`,
    )
  }

  const now = new Date().toISOString()
  const parent = manifest.diffs.at(-1) ?? null
  const planned = resolvePlanStep(manifest, input.step ?? input.stepId)
  if (!planned) throw new Error('Plan step does not exist')
  const step = planned.index
  const stepId = stepIdOf(planned)
  const title = planned.title
  const currentIds = normalizeCurrentStepIds(manifest)
  if (parent && parent.status !== 'extend' && parent.status !== 'applied') {
    throw new Error(`Diff ${parent.id} must be continued or replanned first`)
  }
  if (parent?.status === 'extend' && step !== parent.step) {
    throw new Error(`A revised diff must continue step ${parent.step}`)
  }
  if (parent?.status !== 'extend' && !currentIds.includes(stepId)) {
    throw new Error(`Step ${stepId} is not currently invoked`)
  }

  const knownFileIds = readCodebaseFileIds(dataDir)
  const snapshotRoot = sessionPaths(dataDir, sessionId).preStep
  const originRoot = fs.existsSync(snapshotRoot) ? snapshotRoot : targetRoot
  let overlay
  if (input.overlay) {
    overlay = normalizeChangeOverlay(input.overlay)
  } else if (input.patchText) {
    overlay = overlayFromPatchText(input.patchText, knownFileIds)
    captureBaseline(dataDir, sessionId, originRoot, overlayFileIds(overlay))
    applyUnifiedPatch(input.patchText, targetRoot)
  } else {
    overlay = captureChangeOverlay(dataDir, sessionId, targetRoot, knownFileIds)
  }
  overlay = attachChangeNotes(overlay, input.changeNotes)
  if (!overlayHasChanges(overlay)) {
    throw new Error('No file changes to record for this step')
  }
  if (!input.patchText) {
    captureBaseline(dataDir, sessionId, originRoot, overlayFileIds(overlay))
  }
  if (parent?.status === 'extend') parent.status = 'extended'

  const id = String(manifest.diffs.length + 1).padStart(4, '0')
  const file = `diffs/${id}.json`
  const entry = {
    id,
    file,
    parentId: parent?.id ?? null,
    step,
    stepId,
    title,
    status: 'applied',
    instruction: null,
    createdAt: now,
    decidedAt: now,
  }
  manifest.diffs.push(entry)
  const completed = completedStepIds(manifest)
  const remaining = (manifest.steps ?? []).filter(
    (item) => !completed.has(stepIdOf(item)),
  )
  const deliveryDone =
    remaining.filter(
      (item) => (item.delivery ?? 0) === currentDeliveryIndex(manifest),
    ).length === 0
  const isLastPlanned = remaining.length === 0
  const finishSession = isLastPlanned && !hasLaterDelivery(manifest)
  entry.status = finishSession ? 'pending' : 'applied'
  entry.decidedAt = finishSession ? null : now
  const paths = sessionPaths(dataDir, sessionId)
  fs.mkdirSync(paths.diffs, { recursive: true })
  atomicWrite(path.join(paths.root, file), `${JSON.stringify(overlay, null, 2)}\n`)
  manifest.activeDiffId = id
  manifest.pendingInstruction = null
  const leftoverCurrent = currentIds.filter((item) => item !== stepId)
  if (finishSession) {
    manifest.phase = 'review'
    manifest.workStartedAt = null
    syncCurrentStep(manifest, leftoverCurrent.length ? leftoverCurrent : [stepId])
  } else if (isLastPlanned || deliveryDone) {
    manifest.currentDelivery = currentDeliveryIndex(manifest) + 1
    manifest.phase = 'preparing'
    manifest.workStartedAt = new Date().toISOString()
    const lastIndex = Math.max(
      0,
      ...(manifest.steps ?? []).map((item) => item.index),
    )
    manifest.currentStep = lastIndex + 1
    manifest.currentStepIds = []
  } else {
    manifest.phase = 'working'
    manifest.workStartedAt = new Date().toISOString()
    const nextIds = nextInvokedStepIds(
      manifest.steps,
      completed,
      leftoverCurrent,
      input.maxSubagents ?? 4,
    )
    syncCurrentStep(manifest, nextIds)
  }
  writeManifest(dataDir, manifest)
  focusSession(dataDir, sessionId)
  if (!isLastPlanned && !deliveryDone) {
    const nextIds = normalizeCurrentStepIds(manifest)
    const nextTitle = nextIds
      .map((item) => {
        const found = manifest.steps.find((stepItem) => stepIdOf(stepItem) === item)
        return found?.title ? `${item} — ${found.title}` : item
      })
      .join('; ')
    recordSessionAck(
      dataDir,
      sessionId,
      'invoke',
      nextIds.length > 1 ? `steps ${nextTitle}` : `step ${nextTitle || manifest.currentStep}`,
    )
  } else if (!finishSession) {
    const next =
      manifest.deliveries.find((item) => item.index === manifest.currentDelivery) ??
      null
    recordSessionAck(
      dataDir,
      sessionId,
      'deliveries',
      next
        ? `delivery ${next.index} — ${next.title}`
        : `delivery ${manifest.currentDelivery}`,
    )
  }
  const latest = readManifest(dataDir, sessionId)
  if (!latest) {
    throw new Error(`Session ${sessionId} disappeared after publishing a diff`)
  }
  return {
    manifest: latest,
    entry: latest.diffs.find((item) => item.id === id) ?? entry,
  }
}

function pendingActive(manifest, diffId) {
  if (manifest.activeDiffId !== diffId) throw new Error('Stale diff decision')
  const active = manifest.diffs.at(-1)
  if (
    manifest.phase !== 'review' ||
    !active ||
    active.id !== diffId ||
    active.status !== 'pending'
  ) {
    throw new Error(`Diff ${diffId} is not ready for review`)
  }
  return active
}

function applyUnresolved(manifest, diffId) {
  const unresolved = unresolvedEntries(manifest, diffId)
  for (const entry of unresolved) {
    entry.status = 'applied'
    entry.decidedAt = new Date().toISOString()
  }
}

export function continueDiff(dataDir, targetRoot, sessionId, diffId) {
  const manifest = requireManifest(dataDir, sessionId)
  const active = pendingActive(manifest, diffId)
  applyUnresolved(manifest, diffId)

  if (active.step >= manifest.steps.length) {
    manifest.phase = 'finished'
    manifest.status = 'finished'
    writeManifest(dataDir, manifest)
    finalizeFinishedSession(dataDir, sessionId, targetRoot)
    return manifest
  }
  manifest.currentStep = active.step + 1
  manifest.phase = 'plan_ready'
  manifest.workStartedAt = null
  writeManifest(dataDir, manifest)
  return autoAdvance(dataDir, sessionId, targetRoot)
}

export function notifySessionExplain(dataDir, sessionId, detail) {
  const manifest = readManifest(dataDir, sessionId)
  if (!manifest) return null
  writeManifest(dataDir, manifest)
  recordSessionAck(
    dataDir,
    sessionId,
    'explain',
    typeof detail === 'string' && detail.trim() ? detail.trim() : 'a map target',
  )
  return manifest
}

export function requestExplainProposal(dataDir, sessionId, diffId) {
  const manifest = requireManifest(dataDir, sessionId)
  let title
  if (manifest.phase === 'review') {
    const active =
      (diffId &&
        manifest.activeDiffId === diffId &&
        manifest.diffs.find(
          (entry) => entry.id === diffId && entry.status === 'pending',
        )) ||
      manifest.diffs.find(
        (entry) =>
          entry.id === manifest.activeDiffId && entry.status === 'pending',
      ) ||
      manifest.diffs.at(-1)
    if (!active || active.status !== 'pending') {
      throw new Error('No proposal to explain')
    }
    title =
      manifest.steps.find((step) => step.index === active.step)?.title ||
      active.title ||
      `step ${active.step}`
  } else if (manifest.phase === 'plan_ready' || manifest.phase === 'working') {
    const step = manifest.currentStep
    title =
      manifest.steps.find((item) => item.index === step)?.title || `step ${step}`
  } else {
    throw new Error('No proposal to explain')
  }
  manifest.pendingExplain = true
  writeManifest(dataDir, manifest)
  recordSessionAck(dataDir, sessionId, 'explain', `the proposal for ${title}`)
  focusSession(dataDir, sessionId)
  return manifest
}

export function consumeExplainRequest(dataDir, sessionId) {
  const manifest = readManifest(dataDir, sessionId)
  if (!manifest?.pendingExplain) return null
  manifest.pendingExplain = false
  writeManifest(dataDir, manifest)
  return manifest
}

export function clearPendingExplain(dataDir, sessionId = null) {
  const ids = sessionId
    ? [assertSessionId(sessionId)]
    : listStoredSessionIds(dataDir)
  let last = null
  for (const id of ids) {
    const manifest = readManifest(dataDir, id)
    if (!manifest?.pendingExplain) continue
    manifest.pendingExplain = false
    writeManifest(dataDir, manifest)
    last = manifest
  }
  return last
}

export function touchExplainConnections(dataDir) {
  const active = readActiveSession(dataDir)
  const ids = new Set(listStoredSessionIds(dataDir).filter((id) => {
    const manifest = readManifest(dataDir, id)
    return Boolean(manifest?.pendingExplain)
  }))
  if (active) ids.add(active)
  for (const id of ids) {
    if (isTerminalSession(readManifest(dataDir, id))) continue
    touchSessionConnection(dataDir, id)
  }
}

function unstageDiffSessionArtifacts(dataDir, targetRoot, extraPaths = []) {
  if (!targetRoot) return
  unstagePaths(targetRoot, [
    ...extraPaths,
    diffSessionsRoot(dataDir),
    userContextFile(dataDir),
    path.join(dataDir, 'chats.json'),
    ...LEGACY_STATE_FILES.map((name) => path.join(dataDir, name)),
  ])
}

function resetColorSlot(dataDir, sessionId, targetRoot = null) {
  const safeId = assertSessionId(sessionId)
  resetLlmSessionWork(dataDir, safeId, targetRoot)
  const manifest = readManifest(dataDir, safeId)
  if (!manifest) return
  const dir = sessionPaths(dataDir, safeId).context
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  writeLocalBlueprint(dataDir, safeId, emptyBlueprint())
  const next = readManifest(dataDir, safeId)
  if (!next) return
  next.initialInstruction = null
  next.contextFiles = []
  writeManifest(dataDir, next)
}

function discardStoredSession(
  dataDir,
  sessionId,
  targetRoot = null,
  { restore = true, keepStoppedMarker = false } = {},
) {
  const safeId = assertSessionId(sessionId)
  const paths = sessionPaths(dataDir, safeId)
  const fileIds = Object.keys(readBaseline(dataDir, safeId).files)
  if (targetRoot && restore) {
    try {
      restoreBaseline(dataDir, safeId, targetRoot)
    } catch {
      // Incomplete session artifacts should still be deleted.
    }
  }
  if (targetRoot) {
    unstageDiffSessionArtifacts(
      dataDir,
      targetRoot,
      fileIds.flatMap((id) => {
        try {
          return [resolveTargetFile(targetRoot, id).absolute]
        } catch {
          return []
        }
      }),
    )
  }
  if (fs.existsSync(paths.root)) {
    fs.rmSync(paths.root, { recursive: true, force: true })
  }
  if (!keepStoppedMarker) clearStoppedMarker(dataDir, safeId)
  const active = readActiveSession(dataDir)
  if (active === safeId) writeActiveSession(dataDir, null)
}

export function discardInactiveDiffSessions(
  dataDir,
  targetRoot = null,
  waiterIds = waiterSessionIds(),
) {
  const keep = new Set()
  for (const value of waiterIds) {
    try {
      keep.add(assertSessionId(value))
    } catch {
      // Ignore process command lines with invalid session ids.
    }
  }

  for (const sessionId of listStoredSessionIds(dataDir)) {
    const manifest = readManifest(dataDir, sessionId)
    if (!isTerminalSession(manifest)) continue
    const stopping = keep.has(sessionId) && isSessionStopped(dataDir, sessionId)
    if (stopping) continue
    discardStoredSession(dataDir, sessionId, targetRoot, {
      restore: shouldRestoreDiscardedSession(manifest),
    })
  }

  const liveIds = listStoredSessionIds(dataDir).filter(
    (id) => !isTerminalSession(readManifest(dataDir, id)),
  )
  const active = readActiveSession(dataDir)
  if (active && !liveIds.includes(active)) writeActiveSession(dataDir, null)
  unstageDiffSessionArtifacts(dataDir, targetRoot)
  return liveIds
}

export function recycleDisconnectedSessions(
  dataDir,
  targetRoot = null,
  waiterIds = waiterSessionIds(),
) {
  const waiters = new Set()
  for (const value of waiterIds) {
    try {
      waiters.add(assertSessionId(value))
    } catch {
      // Ignore process command lines with invalid session ids.
    }
  }

  const recycled = []
  for (const sessionId of listOpenSessionIds(dataDir, waiters)) {
    const manifest = readManifest(dataDir, sessionId)
    if (!manifest || manifest.awaitingAttach) continue
    if (isSessionConnected(dataDir, sessionId, waiters)) continue
    stopSession(dataDir, sessionId, targetRoot)
    recycled.push(sessionId)
  }
  return recycled
}

export function clearDiffSessions(dataDir, targetRoot = null) {
  for (const sessionId of listStoredSessionIds(dataDir)) {
    const manifest = readManifest(dataDir, sessionId)
    discardStoredSession(dataDir, sessionId, targetRoot, {
      restore: shouldRestoreDiscardedSession(manifest),
    })
  }
  writeActiveSession(dataDir, null)
  writeChats(dataDir, emptyChats())
  removeLegacyStateFiles(dataDir)

  const root = diffSessionsRoot(dataDir)
  fs.mkdirSync(root, { recursive: true })
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === '.gitkeep') continue
    fs.rmSync(path.join(root, entry.name), { recursive: true, force: true })
  }
  unstageDiffSessionArtifacts(dataDir, targetRoot)
}

export function recoverOpenDiffSessions(dataDir, targetRoot = null) {
  // Visualizer startup never restores a previous LLM session.
  clearDiffSessions(dataDir, targetRoot)
  return ensureSessionPool(dataDir).map((manifest) => manifest.sessionId)
}

export function stopSession(dataDir, sessionId, targetRoot = null) {
  const safeId = assertSessionId(sessionId)
  if (resolveSessionColor(safeId) && readManifest(dataDir, safeId)) {
    try {
      resetColorSlot(dataDir, safeId, targetRoot)
    } finally {
      setChatLocked(dataDir, safeId, false)
      if (readActiveSession(dataDir) === safeId) writeActiveSession(dataDir, null)
      refillSessionPool(dataDir)
    }
    return null
  }
  // Abandon plan/patches only. Do not restore or delete live project files.
  writeStoppedMarker(dataDir, safeId)
  discardStoredSession(dataDir, safeId, targetRoot, {
    restore: false,
    keepStoppedMarker: true,
  })
  const waiters = waiterSessionIds()
  waiters.add(safeId)
  discardInactiveDiffSessions(dataDir, targetRoot, waiters)
  refillSessionPool(dataDir)
  return null
}

export function decideDiff(
  dataDir,
  targetRoot,
  sessionId,
  diffId,
  decision,
) {
  if (decision === 'approved') {
    return continueDiff(dataDir, targetRoot, sessionId, diffId)
  }
  return stopSession(dataDir, sessionId, targetRoot)
}

export function closeSession(dataDir, sessionId) {
  const active = readActiveSession(dataDir)
  if (active === assertSessionId(sessionId)) writeActiveSession(dataDir, null)
}

export function finalizeFinishedSession(dataDir, sessionId, targetRoot = null) {
  const safeId = assertSessionId(sessionId)
  if (resolveSessionColor(safeId) && readManifest(dataDir, safeId)) {
    try {
      resetColorSlot(dataDir, safeId, targetRoot)
    } finally {
      setChatLocked(dataDir, safeId, false)
      if (readActiveSession(dataDir) === safeId) writeActiveSession(dataDir, null)
      refillSessionPool(dataDir)
    }
    return
  }
  writeReleasedMarker(dataDir, safeId)
  discardStoredSession(dataDir, safeId, targetRoot, { restore: false })
  refillSessionPool(dataDir)
}

export function completeSession(dataDir, sessionId, targetRoot = null) {
  const safeId = assertSessionId(sessionId)
  if (!readManifest(dataDir, safeId)) {
    throw new Error(`No workflow session found for ${safeId}`)
  }
  finalizeFinishedSession(dataDir, safeId, targetRoot)
  return null
}

export function emptyBlueprint() {
  return {
    hidden: false,
    revision: 0,
    enabled: false,
    sent: true,
    files: [],
    folders: [],
    addedFunctions: [],
    addedVariables: [],
    addedImports: [],
    notes: [],
    pointers: [],
    dependsOn: [],
  }
}

function namedBlueprintFiles(value) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    if (
      typeof item.id !== 'string' ||
      typeof item.name !== 'string' ||
      item.name.trim() === '' ||
      typeof item.path !== 'string' ||
      typeof item.folder !== 'string' ||
      item.naming
    ) {
      return []
    }
    return [
      {
        id: item.id,
        name: item.name,
        path: item.path,
        folder: item.folder,
      },
    ]
  })
}

function namedBlueprintFolders(value) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    if (
      typeof item.id !== 'string' ||
      typeof item.name !== 'string' ||
      item.name.trim() === '' ||
      typeof item.path !== 'string' ||
      typeof item.parent !== 'string' ||
      item.naming
    ) {
      return []
    }
    return [
      {
        id: item.id,
        name: item.name,
        path: item.path,
        parent: item.parent,
      },
    ]
  })
}

function namedBlueprintSymbols(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => {
    if (!item || typeof item !== 'object') return false
    return (
      typeof item.name === 'string' &&
      item.name.trim() !== '' &&
      typeof item.file === 'string' &&
      item.file.trim() !== ''
    )
  })
}

function namedBlueprintImportAdditions(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => {
    if (!item || typeof item !== 'object') return false
    return (
      typeof item.name === 'string' &&
      item.name.trim() !== '' &&
      typeof item.from === 'string' &&
      item.from.trim() !== '' &&
      typeof item.file === 'string' &&
      item.file.trim() !== ''
    )
  })
}

function namedBlueprintNotes(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const notes = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const file = typeof item.file === 'string' ? item.file.trim() : ''
    const note = typeof item.note === 'string' ? item.note : ''
    if (!file || !note.trim()) continue
    let stored = null
    if (item.kind == null || item.kind === 'file') {
      stored = { file, kind: 'file', note }
    } else if (item.kind === 'folder') {
      stored = { file, kind: 'folder', note }
    } else if (
      (item.kind === 'function' || item.kind === 'variable') &&
      typeof item.name === 'string' &&
      item.name.trim() !== ''
    ) {
      stored = { file, kind: item.kind, name: item.name.trim(), note }
    }
    if (!stored) continue
    const key =
      stored.kind === 'file' || stored.kind === 'folder'
        ? `${stored.kind}:${stored.file}`
        : `${stored.kind}:${stored.file}:${stored.name}`
    if (seen.has(key)) continue
    seen.add(key)
    notes.push(stored)
  }
  return notes
}

function namedBlueprintPointers(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const pointers = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const path = typeof item.path === 'string' ? item.path.trim() : ''
    if (!path) continue
    let stored = null
    if (item.kind === 'file' || item.kind === 'folder') {
      stored = { kind: item.kind, path }
    } else if (
      (item.kind === 'function' || item.kind === 'variable') &&
      typeof item.name === 'string' &&
      item.name.trim() !== ''
    ) {
      stored = { kind: item.kind, path, name: item.name.trim() }
    }
    if (!stored) continue
    const key =
      stored.kind === 'file' || stored.kind === 'folder'
        ? `${stored.kind}:${stored.path}`
        : `${stored.kind}:${stored.path}:${stored.name}`
    if (seen.has(key)) continue
    seen.add(key)
    pointers.push(stored)
  }
  return pointers
}

function blueprintContentEqual(left, right) {
  return (
    JSON.stringify({
      files: left.files,
      folders: left.folders,
      addedFunctions: left.addedFunctions,
      addedVariables: left.addedVariables,
      addedImports: left.addedImports,
      notes: left.notes,
      pointers: left.pointers,
      dependsOn: left.dependsOn,
    }) ===
    JSON.stringify({
      files: right.files,
      folders: right.folders,
      addedFunctions: right.addedFunctions,
      addedVariables: right.addedVariables,
      addedImports: right.addedImports,
      notes: right.notes,
      pointers: right.pointers,
      dependsOn: right.dependsOn,
    })
  )
}

function normalizeBlueprint(value, colorId = null, graph = null) {
  const files = namedBlueprintFiles(value?.files ?? value?.userCreatedBlocks)
  const folders = namedBlueprintFolders(value?.folders ?? value?.userCreatedIslands)
  const addedFunctions = namedBlueprintSymbols(value?.addedFunctions)
  const addedVariables = namedBlueprintSymbols(value?.addedVariables)
  const addedImports = namedBlueprintImportAdditions(value?.addedImports)
  const notes = namedBlueprintNotes(value?.notes)
  const pointers = namedBlueprintPointers(value?.pointers)
  const dependsOn = namedBlueprintDependsOn(colorId, value?.dependsOn, graph)
  const revision =
    Number.isInteger(value?.revision) && value.revision >= 0 ? value.revision : 0
  return {
    hidden: Boolean(value?.hidden),
    revision,
    enabled: blueprintHasContent({
      files,
      folders,
      addedFunctions,
      addedVariables,
      addedImports,
      notes,
      pointers,
    }),
    sent: true,
    files,
    folders,
    addedFunctions,
    addedVariables,
    addedImports,
    notes,
    pointers,
    dependsOn,
  }
}

function persistBlueprintFile(file, incoming, current, colorId = null, graph = null) {
  const next = normalizeBlueprint(
    {
      ...current,
      ...incoming,
      files: incoming?.files ?? incoming?.userCreatedBlocks ?? current.files,
      folders: incoming?.folders ?? incoming?.userCreatedIslands ?? current.folders,
      dependsOn:
        incoming?.dependsOn !== undefined ? incoming.dependsOn : current.dependsOn,
      hidden:
        incoming?.hidden !== undefined ? incoming.hidden : current.hidden,
    },
    colorId,
    graph,
  )
  if (!blueprintContentEqual(current, next)) {
    next.revision = current.revision + 1
  } else {
    next.revision = current.revision
  }
  next.enabled = blueprintHasContent(next)
  next.sent = true
  if (
    current.hidden === next.hidden &&
    current.revision === next.revision &&
    current.enabled === next.enabled &&
    current.sent === next.sent &&
    blueprintContentEqual(current, next)
  ) {
    return current
  }
  atomicWrite(
    file,
    `${JSON.stringify(
      {
        hidden: Boolean(next.hidden),
        revision: next.revision,
        enabled: next.enabled,
        sent: true,
        files: namedBlueprintFiles(next.files),
        folders: namedBlueprintFolders(next.folders),
        addedFunctions: namedBlueprintSymbols(next.addedFunctions),
        addedVariables: namedBlueprintSymbols(next.addedVariables),
        addedImports: namedBlueprintImportAdditions(next.addedImports),
        notes: namedBlueprintNotes(next.notes),
        pointers: namedBlueprintPointers(next.pointers),
        dependsOn: next.dependsOn,
      },
      null,
      2,
    )}\n`,
  )
  return next
}

export function readBlueprint(dataDir, sessionId) {
  if (sessionId) return readLocalBlueprint(dataDir, sessionId)
  return normalizeBlueprint(
    readJson(blueprintFile(dataDir), emptyBlueprint()),
    DEFAULT_SESSION_COLOR.id,
  )
}

export function readLocalBlueprint(dataDir, sessionId) {
  if (!sessionId) return emptyBlueprint()
  const color = resolveSessionColor(readManifest(dataDir, sessionId)?.color)
  return normalizeBlueprint(
    readJson(localBlueprintFile(dataDir, sessionId), emptyBlueprint()),
    color?.id,
  )
}

export function readBlueprintByColor(dataDir, colorId) {
  const sessionId = findSessionIdByColor(dataDir, colorId)
  return readLocalBlueprint(dataDir, sessionId)
}

export function listLocalBlueprints(dataDir) {
  const seen = new Set()
  const locals = []
  for (const sessionId of listOpenSessionIds(dataDir)) {
    const color = resolveSessionColor(readManifest(dataDir, sessionId)?.color)
    if (!color || seen.has(color.id)) continue
    seen.add(color.id)
    locals.push({
      color: color.id,
      colorName: color.name,
      colorHex: color.hex,
      sessionId,
      ...readLocalBlueprint(dataDir, sessionId),
    })
  }
  return locals.sort((left, right) =>
    compareSessionColorOrder(left.color, right.color),
  )
}

export function writeBlueprint(dataDir, sessionIdOrBlueprint, maybeBlueprint) {
  const incoming =
    maybeBlueprint === undefined ? sessionIdOrBlueprint : maybeBlueprint
  return persistBlueprintFile(
    blueprintFile(dataDir),
    incoming,
    readBlueprint(dataDir),
    DEFAULT_SESSION_COLOR.id,
  )
}

export function writeLocalBlueprint(dataDir, sessionId, incoming) {
  const safeId = assertSessionId(sessionId)
  requireManifest(dataDir, safeId)
  const color = resolveSessionColor(readManifest(dataDir, safeId)?.color)
  const others = listLocalBlueprints(dataDir).filter(
    (item) => item.sessionId !== safeId,
  )
  return persistBlueprintFile(
    localBlueprintFile(dataDir, safeId),
    incoming,
    readLocalBlueprint(dataDir, safeId),
    color?.id,
    colorDependsGraph(others),
  )
}

export function writeBlueprintByColor(dataDir, colorId, incoming) {
  const sessionId = findSessionIdByColor(dataDir, colorId)
  if (!sessionId) return emptyBlueprint()
  return writeLocalBlueprint(dataDir, sessionId, incoming)
}

function blueprintInputFields(input = {}) {
  const { color: _color, ...fields } = input
  return fields
}

export function setBlueprintHidden(dataDir, hidden, colorId = DEFAULT_SESSION_COLOR.id) {
  const color = colorId || DEFAULT_SESSION_COLOR.id
  const current = readBlueprintByColor(dataDir, color)
  return writeBlueprintByColor(dataDir, color, {
    ...current,
    hidden: Boolean(hidden),
  })
}

export function clearBlueprint(dataDir, colorId = DEFAULT_SESSION_COLOR.id) {
  const color = colorId || DEFAULT_SESSION_COLOR.id
  const current = readBlueprintByColor(dataDir, color)
  return writeBlueprintByColor(dataDir, color, {
    ...emptyBlueprint(),
    hidden: current.hidden,
    revision: current.revision,
  })
}

export function cleanupBlueprint(
  dataDir,
  knownFileIds = [],
  knownFolderPaths = [],
  colorId = DEFAULT_SESSION_COLOR.id,
) {
  const color = colorId || DEFAULT_SESSION_COLOR.id
  const current = readBlueprintByColor(dataDir, color)
  const knownFiles = new Set(knownFileIds)
  const knownFolders = new Set(knownFolderPaths)
  const removedFiles = new Set(
    current.files.filter((file) => knownFiles.has(file.id)).map((file) => file.id),
  )
  const removedFolders = new Set(
    current.folders
      .filter((folder) => knownFolders.has(folder.path))
      .map((folder) => folder.path),
  )
  const next = {
    ...current,
    files: current.files.filter((file) => !knownFiles.has(file.id)),
    folders: current.folders.filter((folder) => !knownFolders.has(folder.path)),
    addedFunctions: current.addedFunctions.filter((item) => !removedFiles.has(item.file)),
    addedVariables: current.addedVariables.filter((item) => !removedFiles.has(item.file)),
    addedImports: current.addedImports.filter((item) => !removedFiles.has(item.file)),
    notes: current.notes.filter((item) =>
      item.kind === 'folder'
        ? !removedFolders.has(item.file)
        : !removedFiles.has(item.file),
    ),
    pointers: current.pointers,
  }
  return writeBlueprintByColor(dataDir, color, next)
}

export function markBlueprintSeen(dataDir, sessionId, revision, localRevision) {
  const manifest = readManifest(dataDir, sessionId)
  if (!manifest) return null
  const nextGlobal = Number.isInteger(revision) ? revision : manifest.blueprintRevision
  const nextLocal =
    Number.isInteger(localRevision) ? localRevision : manifest.localBlueprintRevision
  if (
    manifest.blueprintRevision === nextGlobal &&
    manifest.localBlueprintRevision === nextLocal
  ) {
    return manifest
  }
  manifest.blueprintRevision = nextGlobal
  if (Number.isInteger(localRevision)) manifest.localBlueprintRevision = nextLocal
  writeManifest(dataDir, manifest)
  return manifest
}
