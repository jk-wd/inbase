import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  collectCreateFolders,
  extractPatchAdditions,
  extractPatchImports,
  foldersFromFileIds,
  parseUnifiedPatch,
} from './patch-lib.mjs'
import { dropMassKnownCreates, emptyChangeOverlay, normalizeChangeOverlay } from './change-overlay.mjs'
import { shouldIgnoreRelativePath, toPosix } from './scan-ignore.mjs'

const BINARY_PROBE_BYTES = 8000

function unique(ids) {
  return [...new Set(ids)]
}

function runGit(cwd, args) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
}

function gitTopLevel(fromDir) {
  try {
    const result = runGit(fromDir, ['rev-parse', '--show-toplevel'])
    if (result.status !== 0) return null
    const root = result.stdout.trim()
    return root ? path.resolve(root) : null
  } catch {
    return null
  }
}

function isBinaryFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r')
    try {
      const buf = Buffer.alloc(BINARY_PROBE_BYTES)
      const bytes = fs.readSync(fd, buf, 0, buf.length, 0)
      return buf.subarray(0, bytes).includes(0)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return true
  }
}

function shouldSkipPath(fileId) {
  return shouldIgnoreRelativePath(fileId)
}

export function normalizeBranchChangesBase(value) {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (!name || name === 'HEAD') return null
  if (name.startsWith('-') || name.includes('..') || /[\s\\~^:?*[\]]/.test(name)) {
    return null
  }
  return name
}

function currentBranch(cwd) {
  const result = runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (result.status !== 0) return null
  const name = result.stdout.trim()
  return name || null
}

function refExists(gitRoot, name) {
  const check = runGit(gitRoot, ['rev-parse', '--verify', '--quiet', name])
  return check.status === 0 && Boolean(check.stdout.trim())
}

function listRefs(gitRoot, prefix) {
  const result = runGit(gitRoot, [
    'for-each-ref',
    '--format=%(refname:short)',
    '--sort=refname',
    prefix,
  ])
  if (result.status !== 0) return []
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function listCompareBranches(gitRoot, current) {
  const locals = listRefs(gitRoot, 'refs/heads').filter(
    (name) => name !== current,
  )
  const remotes = listRefs(gitRoot, 'refs/remotes').filter(
    (name) => !name.endsWith('/HEAD'),
  )
  return [
    ...locals.map((name) => ({ name, remote: false })),
    ...remotes.map((name) => ({ name, remote: true })),
  ]
}

function parseNameStatus(text) {
  const files = []
  const creates = []
  const deletes = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const status = line.slice(0, tab).trim()
    const filePath = toPosix(line.slice(tab + 1).trim())
    if (!filePath || filePath.includes('\t') || shouldSkipPath(filePath)) continue
    const code = status[0]
    if (code === 'A') creates.push(filePath)
    else if (code === 'D') deletes.push(filePath)
    else if (code === 'M' || code === 'T') files.push(filePath)
  }
  return { files, creates, deletes }
}

function fileAsAddPatch(fileId, contents) {
  const lines = contents.split('\n')
  if (contents.endsWith('\n')) lines.pop()
  const count = lines.length
  const hunk =
    count === 0
      ? []
      : [`@@ -0,0 +1,${count} @@`, ...lines.map((line) => `+${line}`)]
  return [
    `diff --git a/${fileId} b/${fileId}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${fileId}`,
    ...hunk,
    '',
  ].join('\n')
}

function collectUntracked(targetRoot) {
  const result = runGit(targetRoot, ['ls-files', '--others', '--exclude-standard'])
  const creates = []
  const patches = []
  const createLines = {}
  if (result.status !== 0) return { creates, patches, createLines }

  for (const raw of result.stdout.split('\n')) {
    const fileId = toPosix(raw.trim())
    if (!fileId || shouldSkipPath(fileId)) continue
    const absolute = path.join(targetRoot, fileId)
    try {
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue
    } catch {
      continue
    }
    if (isBinaryFile(absolute)) continue
    const contents = fs.readFileSync(absolute, 'utf8')
    creates.push(fileId)
    patches.push(fileAsAddPatch(fileId, contents))
    const lineCount =
      contents === ''
        ? 1
        : contents.split('\n').length - (contents.endsWith('\n') ? 1 : 0)
    createLines[fileId] = Math.max(1, lineCount)
  }
  return { creates, patches, createLines }
}

export function emptyBranchChanges() {
  return {
    available: false,
    branch: null,
    base: null,
    current: true,
    branches: [],
    baseMissing: false,
    ...emptyChangeOverlay(),
  }
}

export function hasGitRepo(targetRoot) {
  return Boolean(targetRoot && gitTopLevel(targetRoot))
}

/** Working tree vs HEAD, including unstaged and untracked files. */
export function readWorkingTreeChanges(targetRoot, knownFileIds = []) {
  if (!hasGitRepo(targetRoot)) return emptyChangeOverlay()
  return dropMassKnownCreates(
    collectDiff(
      targetRoot,
      knownFileIds,
      ['--no-color', '--no-ext-diff', '--no-renames', '--relative', 'HEAD'],
      true,
    ),
    knownFileIds,
  )
}

/**
 * Mapped files gone from disk that git name-status will not report as D
 * (never in the compared ref — e.g. deleted untracked / never-pushed).
 */
export function absentKnownFiles(targetRoot, knownFileIds, skipIds) {
  const skip = new Set(skipIds)
  const absent = []
  for (const fileId of knownFileIds) {
    if (!fileId || skip.has(fileId) || shouldSkipPath(fileId)) continue
    const absolute = path.join(targetRoot, fileId)
    try {
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
        absent.push(fileId)
      }
    } catch {
      absent.push(fileId)
    }
  }
  return absent
}

/** Ensure overlay lists mapped files that vanished without a git D entry. */
export function withAbsentMappedFiles(overlay, targetRoot, knownFileIds = []) {
  const normalized = normalizeChangeOverlay(overlay)
  if (!targetRoot) return normalized
  const absent = absentKnownFiles(targetRoot, knownFileIds, [
    ...normalized.creates,
    ...normalized.files,
    ...normalized.deletes,
  ])
  // Also drop creates that no longer exist on disk (stale step overlays).
  const goneCreates = normalized.creates.filter((id) => {
    if (!id || shouldSkipPath(id)) return false
    try {
      const absolute = path.join(targetRoot, id)
      return !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()
    } catch {
      return true
    }
  })
  const hide = new Set([...absent, ...goneCreates])
  const creates = normalized.creates.filter((id) => !hide.has(id))
  return {
    ...normalized,
    creates,
    createLines: Object.fromEntries(
      Object.entries(normalized.createLines).filter(([id]) => !hide.has(id)),
    ),
    createFolders: collectCreateFolders(
      creates,
      foldersFromFileIds(knownFileIds.filter((id) => !creates.includes(id))),
    ),
    absent: unique([...normalized.absent, ...absent, ...goneCreates]),
  }
}

function collectDiff(targetRoot, knownFileIds, diffArgs, includeUntracked) {
  const statusResult = runGit(targetRoot, ['diff', '--name-status', ...diffArgs])
  const patchResult = runGit(targetRoot, ['diff', ...diffArgs])
  const named = parseNameStatus(
    statusResult.status === 0 ? statusResult.stdout : '',
  )
  const untracked = includeUntracked
    ? collectUntracked(targetRoot)
    : { creates: [], patches: [], createLines: {} }
  const creates = unique([...named.creates, ...untracked.creates])
  const deletes = named.deletes.filter((id) => !creates.includes(id))
  const files = named.files.filter(
    (id) => !creates.includes(id) && !deletes.includes(id),
  )
  const patchText = [patchResult.status === 0 ? patchResult.stdout : '', ...untracked.patches]
    .filter((part) => part.trim())
    .join('\n')
  const parsed = parseUnifiedPatch(patchText)
  const known = unique([...knownFileIds, ...creates, ...files])
  return withAbsentMappedFiles(
    {
      files,
      creates,
      deletes,
      createFolders: collectCreateFolders(
        creates,
        foldersFromFileIds(knownFileIds.filter((id) => !creates.includes(id))),
      ),
      createLines: { ...parsed.createLines, ...untracked.createLines },
      imports: extractPatchImports(parsed.entries, known),
      ...extractPatchAdditions(parsed.entries),
    },
    targetRoot,
    knownFileIds,
  )
}

export function readBranchChanges(
  targetRoot,
  knownFileIds = [],
  baseInput = null,
) {
  const empty = emptyBranchChanges()
  if (!targetRoot || !fs.existsSync(targetRoot)) return empty
  const gitRoot = gitTopLevel(targetRoot)
  if (!gitRoot) return empty

  const branch = currentBranch(targetRoot) ?? currentBranch(gitRoot)
  const branches = listCompareBranches(gitRoot, branch)
  const requested = normalizeBranchChangesBase(baseInput)
  const usingCurrent = !requested || requested === branch
  let ref = 'HEAD'
  let base = branch ?? 'HEAD'
  let baseMissing = false
  if (!usingCurrent) {
    if (refExists(gitRoot, requested)) {
      ref = requested
      base = requested
    } else {
      baseMissing = true
    }
  }

  return {
    available: true,
    branch,
    base,
    current: usingCurrent || baseMissing,
    branches,
    baseMissing,
    ...collectDiff(
      targetRoot,
      knownFileIds,
      ['--no-color', '--no-ext-diff', '--no-renames', '--relative', ref],
      true,
    ),
  }
}
