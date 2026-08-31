import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  accumulatePatchAdditions,
  applyUnifiedPatch,
  applyUnifiedPatchToContents,
  collectCreateFolders,
  extractPatchImports,
  foldersFromFileIds,
  parseUnifiedPatch,
} from './patch-lib.mjs'
import { diffSourceTrees, snapshotSourceTree } from './tree-diff.mjs'
import { readExplain } from './explain-store.mjs'

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const CONNECTED_TTL_MS = 15_000
const STALLED_WAIT_MS = 2_000
export const SESSION_SLOT_COUNT = 5
export const SESSION_COLORS = [
  { id: 'coral', name: 'Coral', hex: '#f87171' },
  { id: 'amber', name: 'Amber', hex: '#fbbf24' },
  { id: 'lime', name: 'Lime', hex: '#a3e635' },
  { id: 'orange', name: 'Orange', hex: '#fb923c' },
  { id: 'violet', name: 'Violet', hex: '#c084fc' },
]
export const SESSION_COLOR_ALIASES = {
  coral: 'coral',
  red: 'coral',
  amber: 'amber',
  yellow: 'amber',
  lime: 'lime',
  green: 'lime',
  orange: 'orange',
  violet: 'violet',
  purple: 'violet',
}
const GLOBAL_COLOR_QUERIES = new Set(['blue', 'global', 'sky'])
export const GLOBAL_BLUEPRINT_COLOR = {
  id: 'global',
  name: 'Global',
  hex: '#38bdf8',
}
export const CHAT_LIMIT_MESSAGE =
  'VISUAL_CODER_CHAT_LIMIT Only 5 Inbase chats can be connected at once. Finish or stop one in the map, then start a new chat.'
export const NOT_RUNNING_MESSAGE =
  "VISUAL_CODER_NOT_RUNNING Inbase isn't running. Start it with `npx inbase run`, then send this request again."
export function colorUnknownMessage(query) {
  const label = typeof query === 'string' && query.trim() ? query.trim() : 'That color'
  return `VISUAL_CODER_COLOR_UNKNOWN ${label} is not a chat color. Connect with /coral, /amber, /lime, /orange, or /violet (aliases: /red, /yellow, /green, /purple). Blue is the global blueprint, not a chat.`
}
export function colorBusyMessage(colorName) {
  return `VISUAL_CODER_COLOR_BUSY The ${colorName} session already has a chat connected. Finish or stop it in the map, then try again.`
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

export function parseSessionColorQuery(value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  const key = value.trim().toLowerCase()
  if (GLOBAL_COLOR_QUERIES.has(key)) {
    throw new Error(colorUnknownMessage(key === 'global' ? 'Global' : 'Blue'))
  }
  const id = SESSION_COLOR_ALIASES[key] ?? resolveSessionColor(key)?.id ?? null
  const color = resolveSessionColor(id)
  if (!color) throw new Error(colorUnknownMessage(value.trim()))
  return color
}

function assignedSessionColors(dataDir) {
  const used = new Set()
  for (const sessionId of listOpenSessionIds(dataDir)) {
    const color = readManifest(dataDir, sessionId)?.color
    if (resolveSessionColor(color)) used.add(color)
  }
  return used
}

function nextSessionColor(dataDir) {
  const used = assignedSessionColors(dataDir)
  return SESSION_COLORS.find((entry) => !used.has(entry.id))?.id ?? SESSION_COLORS[0].id
}

function ensureManifestColor(dataDir, manifest) {
  if (!manifest) return manifest
  if (resolveSessionColor(manifest.color)) return manifest
  manifest.color = nextSessionColor(dataDir)
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
  }
}

export function sessionStoppedError(sessionId) {
  return new Error(
    `VISUAL_CODER_STOPPED Session ${assertSessionId(sessionId)} was stopped. Do not modify project files.`,
  )
}

export function isSessionStopped(dataDir, sessionId) {
  return fs.existsSync(sessionPaths(dataDir, sessionId).stopped)
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

function clearStoppedMarker(dataDir, sessionId) {
  const { stopped } = sessionPaths(dataDir, sessionId)
  if (fs.existsSync(stopped)) fs.unlinkSync(stopped)
}

function requireManifest(dataDir, sessionId, missingMessage) {
  const safeId = assertSessionId(sessionId)
  const manifest = readManifest(dataDir, safeId)
  if (manifest) return manifest
  if (isSessionStopped(dataDir, safeId)) throw sessionStoppedError(safeId)
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

export function readActiveSession(dataDir) {
  const value = readJson(path.join(dataDir, 'active-session.json'), null)
  return value?.sessionId ? assertSessionId(value.sessionId) : null
}

export function writeActiveSession(dataDir, sessionId) {
  atomicWrite(
    path.join(dataDir, 'active-session.json'),
    `${JSON.stringify({ sessionId: sessionId ? assertSessionId(sessionId) : null }, null, 2)}\n`,
  )
}

function connectionFile(dataDir, sessionId) {
  return path.join(sessionPaths(dataDir, sessionId).root, 'connected.json')
}

function ackFile(dataDir, sessionId) {
  return path.join(sessionPaths(dataDir, sessionId).root, 'ack.json')
}

export function recordSessionAck(dataDir, sessionId, kind, detail = '') {
  const safeId = assertSessionId(sessionId)
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
  if (isSessionStopped(dataDir, safeId)) return
  atomicWrite(
    connectionFile(dataDir, safeId),
    `${JSON.stringify({ sessionId: safeId, connectedAt: new Date().toISOString() }, null, 2)}\n`,
  )
  const manifest = readManifest(dataDir, safeId)
  if (manifest?.awaitingAttach) {
    manifest.awaitingAttach = false
    writeManifest(dataDir, manifest)
  }
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

function isStalledWorking(manifest, waiterIds, sessionId, now = Date.now()) {
  if (manifest.phase !== 'working') return false
  if (!waiterIds.has(sessionId)) return false
  const started = Date.parse(manifest.workStartedAt)
  return Number.isFinite(started) && now - started >= STALLED_WAIT_MS
}

export function isSessionConnected(
  dataDir,
  sessionId,
  waiterIds = waiterSessionIds(),
) {
  const safeId = assertSessionId(sessionId)
  const manifest = readManifest(dataDir, safeId)
  if (isTerminalSession(manifest)) return false
  if (manifest.awaitingAttach) {
    const connected = readJson(connectionFile(dataDir, safeId), null)
    return waiterIds.has(safeId) || isFreshTimestamp(connected?.connectedAt)
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

export function listSessionIntents(dataDir, knownFileIds = []) {
  const waiters = waiterSessionIds()
  return listOpenSessionIds(dataDir, waiters)
    .map((sessionId) =>
      sessionIntent(dataDir, sessionId, knownFileIds, undefined, waiters),
    )
    .filter(Boolean)
}

export function readBlueprintSession(dataDir) {
  const value = readJson(path.join(dataDir, 'blueprint-session.json'), null)
  return value?.sessionId ? assertSessionId(value.sessionId) : null
}

export function writeBlueprintSession(dataDir, sessionId) {
  atomicWrite(
    path.join(dataDir, 'blueprint-session.json'),
    `${JSON.stringify({ sessionId: sessionId ? assertSessionId(sessionId) : null }, null, 2)}\n`,
  )
}

function releaseBlueprintSession(dataDir, sessionId) {
  const safeId = assertSessionId(sessionId)
  if (readBlueprintSession(dataDir) === safeId) writeBlueprintSession(dataDir, null)
}

export function focusSession(dataDir, sessionId) {
  const safeId = assertSessionId(sessionId)
  requireManifest(dataDir, safeId)
  writeActiveSession(dataDir, safeId)
  return safeId
}

function sessionPoolFile(dataDir) {
  return path.join(dataDir, 'session-pool.json')
}

export function enableSessionPool(dataDir, count = SESSION_SLOT_COUNT) {
  atomicWrite(
    sessionPoolFile(dataDir),
    `${JSON.stringify({ count }, null, 2)}\n`,
  )
}

export function sessionPoolSize(dataDir) {
  const value = readJson(sessionPoolFile(dataDir), null)
  const count = value?.count
  return Number.isInteger(count) && count > 0 ? count : 0
}

export function ensureSessionPool(dataDir, options = {}) {
  const size = sessionPoolSize(dataDir)
  if (size <= 0) {
    enableSessionPool(dataDir, options.count ?? SESSION_SLOT_COUNT)
  }
  const count = sessionPoolSize(dataDir)
  const created = []
  while (listOpenSessionIds(dataDir).length < count) {
    created.push(setupSession(dataDir, { focus: false }))
  }
  if (options.focus !== false && !readActiveSession(dataDir)) {
    const next = nextAttachSessionId(dataDir) ?? listOpenSessionIds(dataDir)[0]
    if (next) focusSession(dataDir, next)
  }
  return created
}

function refillSessionPool(dataDir) {
  if (sessionPoolSize(dataDir) <= 0) return []
  return ensureSessionPool(dataDir, { focus: false })
}

function attachQueueFile(dataDir) {
  return path.join(dataDir, 'attach-queue.json')
}

function readStoredAttachQueue(dataDir) {
  const value = readJson(attachQueueFile(dataDir), null)
  const ids = Array.isArray(value?.sessionIds) ? value.sessionIds : []
  const result = []
  const seen = new Set()
  for (const id of ids) {
    try {
      const safeId = assertSessionId(id)
      if (seen.has(safeId)) continue
      seen.add(safeId)
      result.push(safeId)
    } catch {
      // Skip invalid ids.
    }
  }
  return result
}

function writeAttachQueue(dataDir, sessionIds) {
  atomicWrite(
    attachQueueFile(dataDir),
    `${JSON.stringify({ sessionIds }, null, 2)}\n`,
  )
}

function sessionIsWaitingToAttach(manifest) {
  return Boolean(manifest?.awaitingAttach)
}

export function listAttachQueue(dataDir) {
  const recorded = readStoredAttachQueue(dataDir)
  const waiting = new Set()
  for (const sessionId of listOpenSessionIds(dataDir)) {
    if (sessionIsWaitingToAttach(readManifest(dataDir, sessionId))) {
      waiting.add(sessionId)
    }
  }
  const queued = recorded.filter((sessionId) => waiting.has(sessionId))
  const queuedSet = new Set(queued)
  const missing = []
  for (const sessionId of listOpenSessionIds(dataDir)) {
    if (waiting.has(sessionId) && !queuedSet.has(sessionId)) {
      missing.push(sessionId)
    }
  }
  const next = [...queued, ...missing]
  const unchanged =
    next.length === recorded.length &&
    next.every((sessionId, index) => sessionId === recorded[index])
  if (!unchanged) writeAttachQueue(dataDir, next)
  return next
}

export function nextAttachSessionId(dataDir) {
  return listAttachQueue(dataDir)[0] ?? null
}

function enqueueAttachSession(dataDir, sessionId) {
  const safeId = assertSessionId(sessionId)
  const rest = listAttachQueue(dataDir).filter((id) => id !== safeId)
  writeAttachQueue(dataDir, [...rest, safeId])
}

function blueprintFile(dataDir) {
  return path.join(dataDir, 'blueprint.json')
}

function localBlueprintFile(dataDir, sessionId) {
  return sessionPaths(dataDir, sessionId).blueprint
}

export function isGlobalBlueprintColor(colorId) {
  return !colorId || colorId === GLOBAL_BLUEPRINT_COLOR.id
}

export function findSessionIdByColor(dataDir, colorId) {
  if (isGlobalBlueprintColor(colorId)) return null
  for (const sessionId of listOpenSessionIds(dataDir)) {
    const color = resolveSessionColor(readManifest(dataDir, sessionId)?.color)
    if (color?.id === colorId) return sessionId
  }
  return null
}

function blueprintHasContent(blueprint) {
  return (
    (blueprint.userCreatedBlocks?.length ?? 0) > 0 ||
    (blueprint.userCreatedIslands?.length ?? 0) > 0 ||
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
  if (typeof value.stepByStep !== 'boolean') value.stepByStep = true
  value.initialInstruction =
    typeof value.initialInstruction === 'string' ? value.initialInstruction : null
  value.contextFiles = normalizeContextFiles(value.contextFiles)
  return value
}

export function writeManifest(dataDir, manifest) {
  const paths = sessionPaths(dataDir, manifest.sessionId)
  manifest.updatedAt = new Date().toISOString()
  atomicWrite(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`)
}

export function readDiff(dataDir, sessionId, entry) {
  const paths = sessionPaths(dataDir, sessionId)
  const absolute = path.resolve(paths.root, entry.file)
  if (!absolute.startsWith(`${paths.root}${path.sep}`)) {
    throw new Error(`Invalid diff path for ${entry.id}`)
  }
  return fs.readFileSync(absolute, 'utf8')
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

function isSupersededPatch(entry) {
  return (
    entry.status === 'rejected' ||
    entry.status === 'extend' ||
    entry.status === 'extended'
  )
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

function workingPatchEntries(manifest) {
  return manifest.diffs.filter((entry) => !isSupersededPatch(entry))
}

function unresolvedEntries(manifest, diffId = manifest.activeDiffId) {
  return liveEntries(manifest, diffId).filter((entry) => entry.status !== 'applied')
}

export function previewPatchChain(patches, knownFileIds = []) {
  const state = new Map()
  const lineCounts = new Map()
  const imports = new Map()

  for (const patch of patches) {
    const parsed = parseUnifiedPatch(patch)
    for (const edge of extractPatchImports(parsed.entries, [
      ...knownFileIds,
      ...state.keys(),
    ])) {
      imports.set(`${edge.from}->${edge.to}`, edge)
    }

    for (const entry of parsed.entries) {
      const previous = state.get(entry.id)
      if (entry.kind === 'add') {
        state.set(entry.id, 'add')
        lineCounts.set(entry.id, Math.max(1, entry.addedLines))
        continue
      }
      if (entry.kind === 'delete') {
        if (previous === 'add') {
          state.delete(entry.id)
          lineCounts.delete(entry.id)
        } else {
          state.set(entry.id, 'delete')
        }
        continue
      }

      state.set(entry.id, previous === 'add' ? 'add' : 'modify')
      if (previous === 'add') {
        const delta = entry.hunks.reduce(
          (total, hunk) => total + hunk.newCount - hunk.oldCount,
          0,
        )
        lineCounts.set(entry.id, Math.max(1, (lineCounts.get(entry.id) ?? 1) + delta))
      }
    }
  }

  const deleted = new Set(
    [...state.entries()].filter(([, kind]) => kind === 'delete').map(([id]) => id),
  )
  const creates = [...state.entries()]
    .filter(([, kind]) => kind === 'add')
    .map(([id]) => id)
  return {
    files: [...state.entries()]
      .filter(([, kind]) => kind === 'modify')
      .map(([id]) => id),
    creates,
    deletes: [...deleted],
    createLines: Object.fromEntries(lineCounts),
    createFolders: collectCreateFolders(
      creates,
      foldersFromFileIds(knownFileIds.filter((id) => !creates.includes(id))),
    ),
    imports: [...imports.values()].filter(
      (edge) => !deleted.has(edge.from) && !deleted.has(edge.to),
    ),
    ...accumulatePatchAdditions(patches),
  }
}

export function sessionIntent(
  dataDir,
  sessionId,
  knownFileIds = [],
  selectedDiffId,
  waiterIds = waiterSessionIds(),
) {
  const manifest = readManifest(dataDir, sessionId)
  if (!manifest) return null
  const selectedId = selectedDiffId || manifest.activeDiffId
  const selectedIndex = selectedId ? entryIndex(manifest, selectedId) : null
  const selected =
    selectedIndex === null ? null : manifest.diffs[selectedIndex]
  const patches =
    selectedIndex === null
      ? []
      : liveEntries(manifest, selectedId).map((entry) =>
          readDiff(dataDir, sessionId, entry),
        )
  const preview = previewPatchChain(patches, knownFileIds)
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
  const previewVisible = patches.length > 0
  const blueprint = readBlueprint(dataDir, sessionId)
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
    steps: manifest.steps,
    step: activeView ? manifest.currentStep : selected?.step ?? manifest.currentStep,
    stepByStep: isStepByStep(manifest),
    reason: activeView ? currentPlanStep?.title ?? null : selected?.title ?? null,
    sessionId,
    diffId: selected?.id ?? null,
    parentDiffId: selected?.parentId ?? null,
    chainIndex: selectedIndex,
    chain: manifest.diffs.map((entry, index) => ({
      id: entry.id,
      index,
      step: entry.step,
      title: entry.title,
      status: entry.status,
    })),
    isActiveDiff: Boolean(selected && selected.id === manifest.activeDiffId),
    preview: previewVisible,
    working:
      !manifest.awaitingAttach &&
      (manifest.phase === 'preparing' ||
        manifest.phase === 'working' ||
        manifest.phase === 'replanning'),
    stalledWait: isStalledWorking(manifest, waiterIds, sessionId),
    llmIdle: !isSessionConnected(dataDir, sessionId, waiterIds),
    awaitingAttach:
      Boolean(manifest.awaitingAttach) &&
      !isSessionConnected(dataDir, sessionId, waiterIds),
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
    userCreatedBlocks: blueprint.userCreatedBlocks,
    userCreatedIslands: blueprint.userCreatedIslands,
    ...preview,
    blueprintFunctions: blueprint.addedFunctions,
    blueprintVariables: blueprint.addedVariables,
    blueprintImports: blueprint.addedImports,
    blueprintNotes: blueprint.notes,
    blueprintPointers: blueprint.pointers,
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

function replayPatches(dataDir, sessionId, targetRoot, entries) {
  for (const entry of entries) {
    applyUnifiedPatch(readDiff(dataDir, sessionId, entry), targetRoot)
  }
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

export function materializeDiff(dataDir, targetRoot, sessionId, diffId) {
  const manifest = requireManifest(dataDir, sessionId)
  const through = diffId || manifest.activeDiffId
  if (!through) return manifest
  restoreBaseline(dataDir, sessionId, targetRoot)
  replayPatches(dataDir, sessionId, targetRoot, liveEntries(manifest, through))
  return manifest
}

function loadReplayContents(dataDir, sessionId, targetRoot, patches) {
  const baseline = readBaseline(dataDir, sessionId)
  const paths = sessionPaths(dataDir, sessionId)
  const fileIds = new Set(Object.keys(baseline.files))
  for (const patchText of patches) {
    for (const entry of parseUnifiedPatch(patchText).entries) {
      fileIds.add(entry.id)
    }
  }

  const files = new Map()
  for (const fileId of fileIds) {
    const info = baseline.files[fileId]
    if (info) {
      if (!info.existed) continue
      const stored = resolveTargetFile(paths.baselineFiles, fileId).absolute
      if (fs.existsSync(stored) && fs.statSync(stored).isFile()) {
        files.set(fileId, fs.readFileSync(stored, 'utf8'))
      }
      continue
    }
    const { absolute } = resolveTargetFile(targetRoot, fileId)
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      files.set(fileId, fs.readFileSync(absolute, 'utf8'))
    }
  }
  return files
}

export function validateContinuation(dataDir, manifest, targetRoot, patchText) {
  const prior = workingPatchEntries(manifest).map((entry) =>
    readDiff(dataDir, manifest.sessionId, entry),
  )
  const patches = [...prior, patchText]
  const files = loadReplayContents(
    dataDir,
    manifest.sessionId,
    targetRoot,
    patches,
  )
  for (const next of patches) applyUnifiedPatchToContents(files, next)
}

export function inspectTargetFile(
  dataDir,
  targetRoot,
  { sessionId, diffId, fileId } = {},
) {
  if (sessionId && readManifest(dataDir, sessionId)) {
    materializeDiff(dataDir, targetRoot, sessionId, diffId)
  }
  if (!fileId) return null
  const { absolute } = resolveTargetFile(targetRoot, fileId)
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new Error(`File ${fileId} is not on disk`)
  }
  return absolute
}

function planSteps(titles, startAt = 1) {
  if (!Array.isArray(titles) || titles.length === 0) {
    throw new Error('A plan needs at least one step')
  }
  return titles.map((title, offset) => {
    const trimmed = typeof title === 'string' ? title.trim() : ''
    if (!trimmed) throw new Error('Plan step titles cannot be empty')
    return { index: startAt + offset, title: trimmed }
  })
}

export function isStepByStep(manifest) {
  return manifest?.stepByStep !== false
}

export function autoAdvance(dataDir, sessionId, targetRoot = null) {
  const manifest = readManifest(dataDir, sessionId)
  if (!manifest || isStepByStep(manifest)) return manifest
  if (manifest.phase === 'plan_ready') {
    return invokeStep(dataDir, sessionId, manifest.currentStep, targetRoot)
  }
  if (manifest.phase === 'review') {
    const active = manifest.diffs.at(-1)
    if (!active || active.status !== 'pending') return manifest
    if (active.step >= manifest.steps.length) return manifest
    if (isRevisedProposal(manifest, active)) return manifest
    return invokeStep(dataDir, sessionId, active.step + 1, targetRoot)
  }
  return manifest
}

function isRevisedProposal(manifest, active) {
  return manifest.diffs.some(
    (entry) =>
      entry.id !== active.id &&
      entry.step === active.step &&
      (entry.status === 'extended' || entry.status === 'extend'),
  )
}

export function setStepByStep(dataDir, sessionId, enabled, targetRoot = null) {
  const manifest = requireManifest(dataDir, sessionId)
  manifest.stepByStep = Boolean(enabled)
  writeManifest(dataDir, manifest)
  if (isStepByStep(manifest)) return manifest
  return autoAdvance(dataDir, sessionId, targetRoot)
}

export function startSession(dataDir, input) {
  const sessionId = assertSessionId(input.sessionId)
  clearStoppedMarker(dataDir, sessionId)
  const existing = readManifest(dataDir, sessionId)
  const name = sessionName(input.name) || sessionName(input.feature)
  if (existing) {
    if (name && existing.name !== name) {
      existing.name = name
      writeManifest(dataDir, existing)
    }
    focusSession(dataDir, sessionId)
    return existing
  }

  const now = new Date().toISOString()
  const manifest = {
    version: 2,
    sessionId,
    name,
    feature: featureName(input.feature) || name,
    steps: [],
    status: 'active',
    phase: 'blueprint_ask',
    stepByStep: true,
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
  focusSession(dataDir, sessionId)
  return manifest
}

export function setupSession(dataDir, input = {}) {
  const sessionId = input.sessionId
    ? assertSessionId(input.sessionId)
    : generateVisualizerSessionId(dataDir)
  const existing = readManifest(dataDir, sessionId)
  if (existing && !isTerminalSession(existing)) {
    throw new Error(`Session ${sessionId} already exists`)
  }
  if (!existing && listOpenSessionIds(dataDir).length >= SESSION_SLOT_COUNT) {
    throw new Error(CHAT_LIMIT_MESSAGE)
  }
  if (existing) {
    discardStoredSession(dataDir, sessionId, null, { restore: false })
  }
  clearStoppedMarker(dataDir, sessionId)
  const now = new Date().toISOString()
  const name = sessionName(input.name)
  const manifest = {
    version: 2,
    sessionId,
    name,
    color: nextSessionColor(dataDir),
    feature: featureName(input.feature) || name,
    steps: [],
    status: 'active',
    phase: 'blueprint',
    awaitingAttach: true,
    stepByStep: true,
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
  if (input.focus !== false) focusSession(dataDir, sessionId)
  enqueueAttachSession(dataDir, sessionId)
  return manifest
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

function generateVisualizerSessionId(dataDir) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const sessionId = `viz-${crypto.randomBytes(6).toString('hex')}`
    if (!readManifest(dataDir, sessionId) && !isSessionStopped(dataDir, sessionId)) {
      return sessionId
    }
  }
  throw new Error('Could not allocate a visualizer session id')
}

export function readAttachedSession(dataDir) {
  for (const sessionId of listOpenSessionIds(dataDir)) {
    const manifest = readManifest(dataDir, sessionId)
    if (manifest?.awaitingAttach === false) return sessionId
  }
  return null
}

function resolveAttachSessionId(dataDir, sessionId, options = {}) {
  if (sessionId) return assertSessionId(sessionId)
  if (options.color) {
    const color = parseSessionColorQuery(options.color)
    if (!color) throw new Error(colorUnknownMessage(options.color))
    const matchId = findSessionIdByColor(dataDir, color.id)
    if (!matchId) throw new Error(colorMissingMessage(color.name))
    const existing = requireManifest(dataDir, matchId)
    if (!sessionIsWaitingToAttach(existing)) {
      throw new Error(colorBusyMessage(color.name))
    }
    return matchId
  }
  return nextAttachSessionId(dataDir)
}

export function attachSession(dataDir, sessionId, options = {}) {
  const safeId = resolveAttachSessionId(dataDir, sessionId, options)
  if (!safeId) {
    throw new Error(CHAT_LIMIT_MESSAGE)
  }
  const manifest = requireManifest(
    dataDir,
    safeId,
    `No Inbase session ${safeId} is waiting to connect.`,
  )
  if (isTerminalSession(manifest)) {
    throw sessionStoppedError(safeId)
  }
  focusSession(dataDir, safeId)
  touchSessionConnection(dataDir, safeId)
  const colored = ensureManifestColor(dataDir, manifest)
  const colorName = resolveSessionColor(colored.color)?.name
  recordSessionAck(
    dataDir,
    safeId,
    'attached',
    colorName || resolvedSessionName(colored) || safeId,
  )
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

export function updateBlueprint(dataDir, _sessionId, input = {}) {
  const colorId = input.color
  const fields = blueprintInputFields(input)
  const current = readBlueprintByColor(dataDir, colorId)
  const next = {
    ...current,
    userCreatedBlocks: fields.userCreatedBlocks ?? current.userCreatedBlocks,
    userCreatedIslands: fields.userCreatedIslands ?? current.userCreatedIslands,
    addedFunctions: fields.addedFunctions ?? current.addedFunctions,
    addedVariables: fields.addedVariables ?? current.addedVariables,
    addedImports: fields.addedImports ?? current.addedImports,
    notes: fields.notes ?? current.notes,
    pointers: fields.pointers ?? current.pointers,
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
  releaseBlueprintSession(dataDir, safeId)
  return manifest
}

export function maybeStartVisualizerHandshake(dataDir, sessionId) {
  const safeId = assertSessionId(sessionId)
  const manifest = requireManifest(dataDir, safeId)
  if (manifest.phase !== 'blueprint_ask' && manifest.phase !== 'blueprint') {
    return manifest
  }
  manifest.phase = 'preparing'
  manifest.workStartedAt = new Date().toISOString()
  writeManifest(dataDir, manifest)
  releaseBlueprintSession(dataDir, safeId)
  return manifest
}

export function reportPlan(dataDir, input) {
  const sessionId = assertSessionId(input.sessionId)
  const existing = readManifest(dataDir, sessionId)
  if (!existing && isSessionStopped(dataDir, sessionId)) {
    throw sessionStoppedError(sessionId)
  }
  const now = new Date().toISOString()

  if (existing?.phase === 'blueprint_ask' || existing?.phase === 'blueprint') {
    throw new Error(
      `Session ${sessionId} is waiting for the user to finish the blueprint handshake`,
    )
  }

  if (!existing || existing.phase === 'preparing') {
    const manifest = existing ?? {
      version: 2,
      sessionId,
      name: sessionName(input.name) || sessionName(input.feature),
      feature: input.feature,
      steps: [],
      status: 'active',
      phase: 'preparing',
      stepByStep: true,
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
    manifest.feature = input.feature
    manifest.steps = planSteps(input.stepTitles)
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
      `${manifest.steps.length} step(s)`,
    )
    return autoAdvance(dataDir, sessionId, input.targetRoot)
  }

  if (existing.phase !== 'replanning') {
    throw new Error(`Session ${sessionId} is not waiting for a revised plan`)
  }
  const startAt = existing.currentStep
  existing.steps = [
    ...existing.steps.filter((step) => step.index < startAt),
    ...planSteps(input.stepTitles, startAt),
  ]
  existing.phase = 'plan_ready'
  existing.status = 'active'
  existing.pendingInstruction = null
  existing.workStartedAt = null
  writeManifest(dataDir, existing)
  focusSession(dataDir, sessionId)
  recordSessionAck(
    dataDir,
    sessionId,
    'plan',
    `${existing.steps.filter((step) => step.index >= startAt).length} step(s)`,
  )
  return autoAdvance(dataDir, sessionId, input.targetRoot)
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
          ? `/go on step ${active.step} to finish`
          : `/go on step ${active.step} to continue`,
      )
    }
    return continueDiff(dataDir, targetRoot, sessionId, active.id)
  }

  if (manifest.phase !== 'plan_ready') {
    throw new Error(`Session ${sessionId} is not ready to invoke a step`)
  }
  if (step !== manifest.currentStep || !manifest.steps.some((item) => item.index === step)) {
    throw new Error(`Step ${step} is not the current plan step`)
  }
  manifest.phase = 'working'
  manifest.workStartedAt = new Date().toISOString()
  writeManifest(dataDir, manifest)
  const title = manifest.steps.find((item) => item.index === step)?.title
  recordSessionAck(
    dataDir,
    sessionId,
    'invoke',
    title ? `step ${step} — ${title}` : `step ${step}`,
  )
  if (targetRoot) snapshotPreStep(dataDir, sessionId, targetRoot)
  return manifest
}

export function snapshotPreStep(dataDir, sessionId, targetRoot) {
  const { preStep } = sessionPaths(dataDir, sessionId)
  snapshotSourceTree(targetRoot, preStep)
  return preStep
}

export function readLiveDiff(dataDir, sessionId, targetRoot) {
  const { preStep } = sessionPaths(dataDir, sessionId)
  if (!fs.existsSync(preStep)) {
    throw new Error(
      `Step ${sessionId} has no invoke snapshot. Wait for VISUAL_CODER_EXECUTE before recording file changes.`,
    )
  }
  return diffSourceTrees(preStep, targetRoot)
}

export function appendDiff(dataDir, targetRoot, input) {
  const sessionId = assertSessionId(input.sessionId)
  const manifest = requireManifest(
    dataDir,
    sessionId,
    `Report a plan for session ${sessionId} first`,
  )
  if (manifest.phase !== 'working') {
    throw new Error(`Step ${manifest.currentStep} has not been invoked`)
  }

  const now = new Date().toISOString()
  const parent = manifest.diffs.at(-1) ?? null
  const step = manifest.currentStep
  const title = manifest.steps.find((item) => item.index === step)?.title
  if (!title) throw new Error(`Plan step ${step} does not exist`)
  if (parent && parent.status !== 'extend' && parent.status !== 'applied') {
    throw new Error(`Diff ${parent.id} must be continued or replanned first`)
  }
  if (parent?.status === 'extend' && step !== parent.step) {
    throw new Error(`A revised diff must continue step ${parent.step}`)
  }
  if (parent?.status === 'applied' && step !== parent.step + 1) {
    throw new Error(`The next diff must implement step ${parent.step + 1}`)
  }

  const patchText = input.patchText ?? readLiveDiff(dataDir, sessionId, targetRoot)
  if (!patchText.trim()) {
    throw new Error('No file changes to record for this step')
  }

  const snapshotRoot = sessionPaths(dataDir, sessionId).preStep
  const originRoot = fs.existsSync(snapshotRoot) ? snapshotRoot : targetRoot
  validateContinuation(dataDir, manifest, originRoot, patchText)
  captureBaseline(
    dataDir,
    sessionId,
    originRoot,
    parseUnifiedPatch(patchText).entries.map((entry) => entry.id),
  )
  if (parent?.status === 'extend') parent.status = 'extended'

  const id = String(manifest.diffs.length + 1).padStart(4, '0')
  const file = `diffs/${id}.patch`
  const entry = {
    id,
    file,
    parentId: parent?.id ?? null,
    step,
    title,
    status: 'pending',
    instruction: null,
    createdAt: now,
    decidedAt: null,
  }
  const paths = sessionPaths(dataDir, sessionId)
  fs.mkdirSync(paths.diffs, { recursive: true })
  atomicWrite(
    path.join(paths.root, file),
    patchText.endsWith('\n') ? patchText : `${patchText}\n`,
  )
  manifest.activeDiffId = id
  manifest.phase = 'review'
  manifest.pendingInstruction = null
  manifest.workStartedAt = null
  manifest.diffs.push(entry)
  writeManifest(dataDir, manifest)
  materializeDiff(dataDir, targetRoot, sessionId, id)
  focusSession(dataDir, sessionId)
  const advanced = autoAdvance(dataDir, sessionId, targetRoot)
  if (!advanced) {
    throw new Error(`Session ${sessionId} disappeared after publishing a diff`)
  }
  return {
    manifest: advanced,
    entry: advanced.diffs.find((item) => item.id === id) ?? entry,
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

function applyUnresolved(dataDir, targetRoot, manifest, diffId) {
  const unresolved = unresolvedEntries(manifest, diffId)
  materializeDiff(dataDir, targetRoot, manifest.sessionId, diffId)
  for (const entry of unresolved) {
    entry.status = 'applied'
    entry.decidedAt = new Date().toISOString()
  }
}

export function continueDiff(dataDir, targetRoot, sessionId, diffId) {
  const manifest = requireManifest(dataDir, sessionId)
  const active = pendingActive(manifest, diffId)
  applyUnresolved(dataDir, targetRoot, manifest, diffId)

  if (active.step >= manifest.steps.length) {
    manifest.phase = 'finished'
    manifest.status = 'finished'
    writeManifest(dataDir, manifest)
    finalizeFinishedSession(dataDir, sessionId)
    return manifest
  }
  manifest.currentStep = active.step + 1
  manifest.phase = 'plan_ready'
  manifest.workStartedAt = null
  writeManifest(dataDir, manifest)
  return invokeStep(dataDir, sessionId, manifest.currentStep, targetRoot)
}

export function requestReplan(
  dataDir,
  sessionId,
  diffId,
  instruction,
  targetRoot = null,
) {
  const manifest = requireManifest(dataDir, sessionId)
  const active = pendingActive(manifest, diffId)
  const guidance = typeof instruction === 'string' ? instruction.trim() : ''
  if (!guidance) throw new Error('An alternative instruction is required')
  active.status = 'extend'
  active.instruction = guidance
  active.decidedAt = new Date().toISOString()
  manifest.phase = 'working'
  manifest.pendingInstruction = guidance
  manifest.workStartedAt = new Date().toISOString()
  writeManifest(dataDir, manifest)
  // Keep the current proposal on disk. The instruction updates that latest state.
  void targetRoot
  return manifest
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
  } else if (manifest.phase === 'plan_ready') {
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
    path.join(dataDir, 'active-session.json'),
    path.join(dataDir, 'blueprint-session.json'),
  ])
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
  releaseBlueprintSession(dataDir, safeId)
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
    discardStoredSession(dataDir, sessionId, targetRoot)
  }

  const liveIds = listStoredSessionIds(dataDir).filter(
    (id) => !isTerminalSession(readManifest(dataDir, id)),
  )
  const active = readActiveSession(dataDir)
  if (active && !liveIds.includes(active)) writeActiveSession(dataDir, null)
  const locked = readBlueprintSession(dataDir)
  if (locked && !liveIds.includes(locked)) writeBlueprintSession(dataDir, null)
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
    discardStoredSession(dataDir, sessionId, targetRoot)
  }
  writeActiveSession(dataDir, null)
  writeBlueprintSession(dataDir, null)
  writeAttachQueue(dataDir, [])
  const poolFile = sessionPoolFile(dataDir)
  if (fs.existsSync(poolFile)) fs.unlinkSync(poolFile)

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
  writeStoppedMarker(dataDir, safeId)
  discardStoredSession(dataDir, safeId, targetRoot, { keepStoppedMarker: true })
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
  instruction = '',
) {
  if (decision === 'approved') {
    return continueDiff(dataDir, targetRoot, sessionId, diffId)
  }
  if (decision === 'extend') {
    return requestReplan(dataDir, sessionId, diffId, instruction, targetRoot)
  }
  return stopSession(dataDir, sessionId, targetRoot)
}

export function closeSession(dataDir, sessionId) {
  releaseBlueprintSession(dataDir, sessionId)
  const active = readActiveSession(dataDir)
  if (active === assertSessionId(sessionId)) writeActiveSession(dataDir, null)
}

export function finalizeFinishedSession(dataDir, sessionId) {
  discardStoredSession(dataDir, sessionId, null, { restore: false })
  refillSessionPool(dataDir)
}

export function emptyBlueprint() {
  return {
    hidden: false,
    revision: 0,
    enabled: false,
    sent: true,
    userCreatedBlocks: [],
    userCreatedIslands: [],
    addedFunctions: [],
    addedVariables: [],
    addedImports: [],
    notes: [],
    pointers: [],
  }
}

function namedBlueprintBlocks(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => {
    if (!item || typeof item !== 'object') return false
    return (
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      item.name.trim() !== '' &&
      typeof item.path === 'string' &&
      typeof item.folder === 'string' &&
      typeof item.x === 'number' &&
      typeof item.z === 'number' &&
      !item.naming
    )
  })
}

function namedBlueprintIslands(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => {
    if (!item || typeof item !== 'object') return false
    return (
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      item.name.trim() !== '' &&
      typeof item.path === 'string' &&
      typeof item.parent === 'string' &&
      !item.naming
    )
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
    if (item.kind === 'file') {
      stored = { file, kind: 'file', note }
    } else if (
      (item.kind === 'function' || item.kind === 'variable') &&
      typeof item.name === 'string' &&
      item.name.trim() !== ''
    ) {
      stored = { file, kind: item.kind, name: item.name.trim(), note }
    }
    if (!stored) continue
    const key =
      stored.kind === 'file'
        ? `file:${stored.file}`
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
      userCreatedBlocks: left.userCreatedBlocks,
      userCreatedIslands: left.userCreatedIslands,
      addedFunctions: left.addedFunctions,
      addedVariables: left.addedVariables,
      addedImports: left.addedImports,
      notes: left.notes,
      pointers: left.pointers,
    }) ===
    JSON.stringify({
      userCreatedBlocks: right.userCreatedBlocks,
      userCreatedIslands: right.userCreatedIslands,
      addedFunctions: right.addedFunctions,
      addedVariables: right.addedVariables,
      addedImports: right.addedImports,
      notes: right.notes,
      pointers: right.pointers,
    })
  )
}

function normalizeBlueprint(value) {
  const userCreatedBlocks = namedBlueprintBlocks(value?.userCreatedBlocks)
  const userCreatedIslands = namedBlueprintIslands(value?.userCreatedIslands)
  const addedFunctions = namedBlueprintSymbols(value?.addedFunctions)
  const addedVariables = namedBlueprintSymbols(value?.addedVariables)
  const addedImports = namedBlueprintImportAdditions(value?.addedImports)
  const notes = namedBlueprintNotes(value?.notes)
  const pointers = namedBlueprintPointers(value?.pointers)
  const revision =
    Number.isInteger(value?.revision) && value.revision >= 0 ? value.revision : 0
  return {
    hidden: Boolean(value?.hidden),
    revision,
    enabled: blueprintHasContent({
      userCreatedBlocks,
      userCreatedIslands,
      addedFunctions,
      addedVariables,
      addedImports,
      notes,
      pointers,
    }),
    sent: true,
    userCreatedBlocks,
    userCreatedIslands,
    addedFunctions,
    addedVariables,
    addedImports,
    notes,
    pointers,
  }
}

function persistBlueprintFile(file, incoming, current) {
  const next = normalizeBlueprint({
    ...current,
    ...incoming,
    hidden:
      incoming?.hidden !== undefined ? incoming.hidden : current.hidden,
  })
  if (!blueprintContentEqual(current, next)) {
    next.revision = current.revision + 1
  } else {
    next.revision = current.revision
  }
  next.enabled = blueprintHasContent(next)
  next.sent = true
  atomicWrite(
    file,
    `${JSON.stringify(
      {
        hidden: Boolean(next.hidden),
        revision: next.revision,
        enabled: next.enabled,
        sent: true,
        userCreatedBlocks: namedBlueprintBlocks(next.userCreatedBlocks),
        userCreatedIslands: namedBlueprintIslands(next.userCreatedIslands),
        addedFunctions: namedBlueprintSymbols(next.addedFunctions),
        addedVariables: namedBlueprintSymbols(next.addedVariables),
        addedImports: namedBlueprintImportAdditions(next.addedImports),
        notes: namedBlueprintNotes(next.notes),
        pointers: namedBlueprintPointers(next.pointers),
      },
      null,
      2,
    )}\n`,
  )
  return normalizeBlueprint(readJson(file, emptyBlueprint()))
}

export function readBlueprint(dataDir, _sessionId) {
  return normalizeBlueprint(readJson(blueprintFile(dataDir), emptyBlueprint()))
}

export function readLocalBlueprint(dataDir, sessionId) {
  if (!sessionId) return emptyBlueprint()
  return normalizeBlueprint(
    readJson(localBlueprintFile(dataDir, sessionId), emptyBlueprint()),
  )
}

export function readBlueprintByColor(dataDir, colorId) {
  if (isGlobalBlueprintColor(colorId)) return readBlueprint(dataDir)
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
  return locals.sort(
    (left, right) =>
      SESSION_COLORS.findIndex((entry) => entry.id === left.color) -
      SESSION_COLORS.findIndex((entry) => entry.id === right.color),
  )
}

export function writeBlueprint(dataDir, sessionIdOrBlueprint, maybeBlueprint) {
  const incoming =
    maybeBlueprint === undefined ? sessionIdOrBlueprint : maybeBlueprint
  return persistBlueprintFile(
    blueprintFile(dataDir),
    incoming,
    readBlueprint(dataDir),
  )
}

export function writeLocalBlueprint(dataDir, sessionId, incoming) {
  const safeId = assertSessionId(sessionId)
  requireManifest(dataDir, safeId)
  return persistBlueprintFile(
    localBlueprintFile(dataDir, safeId),
    incoming,
    readLocalBlueprint(dataDir, safeId),
  )
}

export function writeBlueprintByColor(dataDir, colorId, incoming) {
  if (isGlobalBlueprintColor(colorId)) return writeBlueprint(dataDir, incoming)
  const sessionId = findSessionIdByColor(dataDir, colorId)
  if (!sessionId) return emptyBlueprint()
  return writeLocalBlueprint(dataDir, sessionId, incoming)
}

function blueprintInputFields(input = {}) {
  const { color: _color, ...fields } = input
  return fields
}

export function setBlueprintHidden(dataDir, hidden, colorId) {
  const current = readBlueprintByColor(dataDir, colorId)
  return writeBlueprintByColor(dataDir, colorId, {
    ...current,
    hidden: Boolean(hidden),
  })
}

export function clearBlueprint(dataDir, colorId) {
  const current = readBlueprintByColor(dataDir, colorId)
  return writeBlueprintByColor(dataDir, colorId, {
    ...emptyBlueprint(),
    hidden: current.hidden,
    revision: current.revision,
  })
}

export function cleanupBlueprint(
  dataDir,
  knownFileIds = [],
  knownFolderPaths = [],
  colorId,
) {
  const current = readBlueprintByColor(dataDir, colorId)
  const files = new Set(knownFileIds)
  const folders = new Set(knownFolderPaths)
  const removedFiles = new Set(
    current.userCreatedBlocks.filter((block) => files.has(block.id)).map((block) => block.id),
  )
  const next = {
    ...current,
    userCreatedBlocks: current.userCreatedBlocks.filter((block) => !files.has(block.id)),
    userCreatedIslands: current.userCreatedIslands.filter(
      (island) => !folders.has(island.path),
    ),
    addedFunctions: current.addedFunctions.filter((item) => !removedFiles.has(item.file)),
    addedVariables: current.addedVariables.filter((item) => !removedFiles.has(item.file)),
    addedImports: current.addedImports.filter((item) => !removedFiles.has(item.file)),
    notes: current.notes.filter((item) => !removedFiles.has(item.file)),
    pointers: current.pointers,
  }
  return writeBlueprintByColor(dataDir, colorId, next)
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
