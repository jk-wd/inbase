import fs from 'node:fs'
import path from 'node:path'
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

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const CONNECTED_TTL_MS = 15_000
const STALLED_WAIT_MS = 2_000

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
}

function waiterSessionIds() {
  try {
    const result = spawnSync('ps', ['-ax', '-o', 'command='], {
      encoding: 'utf8',
    })
    if (result.status !== 0 || !result.stdout) return new Set()
    const ids = new Set()
    for (const line of result.stdout.split('\n')) {
      if (
        !line.includes('wait-for-blueprint') &&
        !line.includes('wait-for-approval')
      ) {
        continue
      }
      const match = line.match(/--session\s+(\S+)/)
      if (!match) continue
      try {
        ids.add(assertSessionId(match[1]))
      } catch {
        // Ignore process command lines with invalid session ids.
      }
    }
    return ids
  } catch {
    return new Set()
  }
}

function isGeneratingPhase(phase) {
  return phase === 'preparing' || phase === 'working' || phase === 'replanning'
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
  if (!manifest) return false
  if (
    manifest.phase === 'finished' ||
    manifest.phase === 'stopped' ||
    manifest.status === 'finished' ||
    manifest.status === 'rejected'
  ) {
    return false
  }
  if (isGeneratingPhase(manifest.phase)) return true
  if (waiterIds.has(safeId)) return true
  const connected = readJson(connectionFile(dataDir, safeId), null)
  if (isFreshTimestamp(connected?.connectedAt)) return true
  return isFreshTimestamp(manifest.updatedAt) || isFreshTimestamp(manifest.createdAt)
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
      if (!isSessionConnected(dataDir, sessionId, waiterIds)) continue
      const manifest = readManifest(dataDir, sessionId)
      if (!manifest) continue
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

function assertBlueprintSessionAvailable(dataDir, sessionId) {
  const safeId = assertSessionId(sessionId)
  const locked = readBlueprintSession(dataDir)
  if (locked && locked !== safeId) {
    throw new Error(
      `Blueprint edit mode is active in session ${locked}. Finish or stop it before starting another.`,
    )
  }
  return safeId
}

function claimBlueprintSession(dataDir, sessionId) {
  const safeId = assertBlueprintSessionAvailable(dataDir, sessionId)
  writeBlueprintSession(dataDir, safeId)
  return safeId
}

function releaseBlueprintSession(dataDir, sessionId) {
  const safeId = assertSessionId(sessionId)
  if (readBlueprintSession(dataDir) === safeId) writeBlueprintSession(dataDir, null)
}

function focusSession(dataDir, sessionId) {
  const safeId = assertSessionId(sessionId)
  const locked = readBlueprintSession(dataDir)
  if (!locked || locked === safeId) writeActiveSession(dataDir, safeId)
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
  if (typeof value.stepByStep !== 'boolean') value.stepByStep = true
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

function unresolvedEntries(manifest, diffId = manifest.activeDiffId) {
  const chain = chainThrough(manifest, diffId)
  let lastApplied = -1
  chain.forEach((entry, index) => {
    if (entry.status === 'applied') lastApplied = index
  })
  return chain.slice(lastApplied + 1).filter((entry) => entry.status !== 'rejected')
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
      : manifest.diffs
          .slice(0, selectedIndex + 1)
          .filter((entry) => entry.status !== 'rejected')
          .map((entry) => readDiff(dataDir, sessionId, entry))
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
  const blueprintSessionId = readBlueprintSession(dataDir)
  const ownsBlueprintLock = blueprintSessionId === sessionId
  const canEnterBlueprint =
    manifest.phase === 'blueprint_ask' &&
    (!blueprintSessionId || ownsBlueprintLock)

  return {
    updatedAt: manifest.updatedAt,
    showMap: previewVisible,
    status: activeView ? phaseStatus ?? historicalStatus : historicalStatus,
    phase: manifest.phase,
    feature: manifest.feature,
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
      manifest.phase === 'preparing' ||
      manifest.phase === 'working' ||
      manifest.phase === 'replanning',
    stalledWait: isStalledWorking(manifest, waiterIds, sessionId),
    creationMode: manifest.phase === 'blueprint' && ownsBlueprintLock,
    canEnterBlueprint,
    blueprintSessionId,
    userCreatedBlocks: blueprint.userCreatedBlocks,
    userCreatedIslands: blueprint.userCreatedIslands,
    ...preview,
    blueprintFunctions: blueprint.addedFunctions,
    blueprintVariables: blueprint.addedVariables,
    blueprintImports: blueprint.addedImports,
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

function liveEntries(manifest, diffId) {
  return chainThrough(manifest, diffId).filter((entry) => entry.status !== 'rejected')
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
  const prior = manifest.diffs
    .filter((entry) => entry.status !== 'rejected')
    .map((entry) => readDiff(dataDir, manifest.sessionId, entry))
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

function featureName(value) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed
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
    return invokeStep(dataDir, sessionId, active.step + 1, targetRoot)
  }
  return manifest
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
  if (existing) {
    focusSession(dataDir, sessionId)
    return existing
  }

  const now = new Date().toISOString()
  const manifest = {
    version: 2,
    sessionId,
    feature: featureName(input.feature),
    steps: [],
    status: 'active',
    phase: 'blueprint_ask',
    stepByStep: true,
    currentStep: 1,
    activeDiffId: null,
    pendingInstruction: null,
    workStartedAt: null,
    createdAt: now,
    updatedAt: now,
    diffs: [],
  }
  writeManifest(dataDir, manifest)
  writeBlueprint(dataDir, sessionId, emptyBlueprint())
  focusSession(dataDir, sessionId)
  return manifest
}

export function answerBlueprint(dataDir, sessionId, enabled) {
  const manifest = requireManifest(dataDir, sessionId)
  if (manifest.phase !== 'blueprint_ask') {
    throw new Error(`Session ${sessionId} is not asking for a blueprint`)
  }
  if (enabled) claimBlueprintSession(dataDir, sessionId)
  const blueprint = {
    ...emptyBlueprint(),
    enabled: Boolean(enabled),
    sent: !enabled,
  }
  writeBlueprint(dataDir, sessionId, blueprint)
  manifest.phase = enabled ? 'blueprint' : 'preparing'
  if (!enabled) manifest.workStartedAt = new Date().toISOString()
  writeManifest(dataDir, manifest)
  return manifest
}

export function updateBlueprint(dataDir, sessionId, input = {}) {
  const safeId = assertSessionId(sessionId)
  const manifest = requireManifest(dataDir, safeId)
  if (manifest.phase !== 'blueprint') {
    throw new Error(`Session ${safeId} is not in blueprint mode`)
  }
  assertBlueprintSessionAvailable(dataDir, safeId)
  const current = readBlueprint(dataDir, safeId)
  writeBlueprint(dataDir, safeId, {
    ...current,
    enabled: true,
    sent: false,
    userCreatedBlocks: input.userCreatedBlocks ?? current.userCreatedBlocks,
    userCreatedIslands: input.userCreatedIslands ?? current.userCreatedIslands,
    addedFunctions: input.addedFunctions ?? current.addedFunctions,
    addedVariables: input.addedVariables ?? current.addedVariables,
    addedImports: input.addedImports ?? current.addedImports,
  })
  return readBlueprint(dataDir, safeId)
}

export function sendBlueprint(dataDir, sessionId, input = {}) {
  const safeId = assertSessionId(sessionId)
  const manifest = requireManifest(dataDir, safeId)
  if (manifest.phase !== 'blueprint') {
    throw new Error(`Session ${safeId} is not in blueprint mode`)
  }
  assertBlueprintSessionAvailable(dataDir, safeId)
  const current = readBlueprint(dataDir, safeId)
  writeBlueprint(dataDir, safeId, {
    enabled: true,
    sent: true,
    userCreatedBlocks: input.userCreatedBlocks ?? current.userCreatedBlocks,
    userCreatedIslands: input.userCreatedIslands ?? current.userCreatedIslands,
    addedFunctions: input.addedFunctions ?? current.addedFunctions,
    addedVariables: input.addedVariables ?? current.addedVariables,
    addedImports: input.addedImports ?? current.addedImports,
  })
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
      feature: input.feature,
      steps: [],
      status: 'active',
      phase: 'preparing',
      stepByStep: true,
      currentStep: 1,
      activeDiffId: null,
      pendingInstruction: null,
      workStartedAt: null,
      createdAt: now,
      updatedAt: now,
      diffs: [],
    }
    manifest.feature = input.feature
    manifest.steps = planSteps(input.stepTitles)
    manifest.status = 'active'
    manifest.phase = 'plan_ready'
    manifest.pendingInstruction = null
    manifest.workStartedAt = null
    writeManifest(dataDir, manifest)
    focusSession(dataDir, sessionId)
    return autoAdvance(dataDir, sessionId)
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
  return autoAdvance(dataDir, sessionId)
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
          ? `Run step ${active.step} to finish`
          : `Run step ${expected} to continue`,
      )
    }
    applyUnresolved(dataDir, targetRoot, manifest, active.id)
    if (last) {
      manifest.phase = 'finished'
      manifest.status = 'finished'
      writeManifest(dataDir, manifest)
      finalizeFinishedSession(dataDir, sessionId)
      return manifest
    }
    manifest.currentStep = expected
    manifest.phase = 'plan_ready'
    manifest.workStartedAt = null
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
  return manifest
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

  validateContinuation(dataDir, manifest, targetRoot, input.patchText)
  captureBaseline(
    dataDir,
    sessionId,
    targetRoot,
    parseUnifiedPatch(input.patchText).entries.map((entry) => entry.id),
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
    input.patchText.endsWith('\n') ? input.patchText : `${input.patchText}\n`,
  )
  manifest.activeDiffId = id
  manifest.phase = 'review'
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
  return autoAdvance(dataDir, sessionId, targetRoot)
}

export function requestReplan(dataDir, sessionId, diffId, instruction) {
  const manifest = requireManifest(dataDir, sessionId)
  const active = pendingActive(manifest, diffId)
  const guidance = typeof instruction === 'string' ? instruction.trim() : ''
  if (!guidance) throw new Error('An alternative instruction is required')
  active.status = 'extend'
  active.instruction = guidance
  active.decidedAt = new Date().toISOString()
  manifest.phase = 'replanning'
  manifest.pendingInstruction = guidance
  manifest.workStartedAt = new Date().toISOString()
  writeManifest(dataDir, manifest)
  return manifest
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
    const live = keep.has(sessionId) && Boolean(readManifest(dataDir, sessionId))
    const stopping = keep.has(sessionId) && isSessionStopped(dataDir, sessionId)
    if (live || stopping) continue
    discardStoredSession(dataDir, sessionId, targetRoot)
  }

  const liveIds = [...keep].filter((id) => readManifest(dataDir, id))
  const active = readActiveSession(dataDir)
  if (active && !liveIds.includes(active)) writeActiveSession(dataDir, null)
  const locked = readBlueprintSession(dataDir)
  if (locked && !liveIds.includes(locked)) writeBlueprintSession(dataDir, null)
  unstageDiffSessionArtifacts(dataDir, targetRoot)
  return liveIds
}

export function clearDiffSessions(dataDir, targetRoot = null) {
  for (const sessionId of listStoredSessionIds(dataDir)) {
    discardStoredSession(dataDir, sessionId, targetRoot)
  }
  writeActiveSession(dataDir, null)
  writeBlueprintSession(dataDir, null)

  const root = diffSessionsRoot(dataDir)
  fs.mkdirSync(root, { recursive: true })
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === '.gitkeep') continue
    fs.rmSync(path.join(root, entry.name), { recursive: true, force: true })
  }
  unstageDiffSessionArtifacts(dataDir, targetRoot)
}

export function stopSession(dataDir, sessionId, targetRoot = null) {
  const safeId = assertSessionId(sessionId)
  writeStoppedMarker(dataDir, safeId)
  discardStoredSession(dataDir, safeId, targetRoot, { keepStoppedMarker: true })
  const waiters = waiterSessionIds()
  waiters.add(safeId)
  discardInactiveDiffSessions(dataDir, targetRoot, waiters)
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
    return requestReplan(dataDir, sessionId, diffId, instruction)
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
}

export function emptyBlueprint() {
  return {
    enabled: false,
    sent: false,
    userCreatedBlocks: [],
    userCreatedIslands: [],
    addedFunctions: [],
    addedVariables: [],
    addedImports: [],
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

export function readBlueprint(dataDir, sessionId) {
  const { blueprint } = sessionPaths(dataDir, sessionId)
  const value = readJson(blueprint, emptyBlueprint())
  return {
    enabled: Boolean(value?.enabled),
    sent: Boolean(value?.sent),
    userCreatedBlocks: namedBlueprintBlocks(value?.userCreatedBlocks),
    userCreatedIslands: namedBlueprintIslands(value?.userCreatedIslands),
    addedFunctions: namedBlueprintSymbols(value?.addedFunctions),
    addedVariables: namedBlueprintSymbols(value?.addedVariables),
    addedImports: namedBlueprintImportAdditions(value?.addedImports),
  }
}

export function writeBlueprint(dataDir, sessionId, blueprint) {
  const paths = sessionPaths(dataDir, sessionId)
  atomicWrite(
    paths.blueprint,
    `${JSON.stringify(
      {
        enabled: Boolean(blueprint.enabled),
        sent: Boolean(blueprint.sent),
        userCreatedBlocks: namedBlueprintBlocks(blueprint.userCreatedBlocks),
        userCreatedIslands: namedBlueprintIslands(blueprint.userCreatedIslands),
        addedFunctions: namedBlueprintSymbols(blueprint.addedFunctions),
        addedVariables: namedBlueprintSymbols(blueprint.addedVariables),
        addedImports: namedBlueprintImportAdditions(blueprint.addedImports),
      },
      null,
      2,
    )}\n`,
  )
}
