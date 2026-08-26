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

function currentBranch(cwd) {
  const result = runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (result.status !== 0) return null
  const name = result.stdout.trim()
  return name || null
}

function resolveBaseRef(gitRoot) {
  const originHead = runGit(gitRoot, [
    'symbolic-ref',
    '--quiet',
    'refs/remotes/origin/HEAD',
  ])
  if (originHead.status === 0) {
    const ref = originHead.stdout.trim().replace(/^refs\/remotes\//, '')
    if (ref) return ref
  }
  for (const name of ['origin/main', 'origin/master', 'main', 'master']) {
    const check = runGit(gitRoot, ['rev-parse', '--verify', '--quiet', name])
    if (check.status === 0 && check.stdout.trim()) return name
  }
  return 'HEAD'
}

function resolveMergeBase(gitRoot, baseRef) {
  const result = runGit(gitRoot, ['merge-base', 'HEAD', baseRef])
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim()
  return 'HEAD'
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
    files: [],
    creates: [],
    deletes: [],
    createFolders: [],
    createLines: {},
    imports: [],
    addedFunctions: [],
    addedVariables: [],
    addedImports: [],
    changedFunctions: [],
    changedVariables: [],
  }
}

export function readBranchChanges(targetRoot, knownFileIds = []) {
  const empty = emptyBranchChanges()
  if (!targetRoot || !fs.existsSync(targetRoot)) return empty
  const gitRoot = gitTopLevel(targetRoot)
  if (!gitRoot) return empty

  const branch = currentBranch(targetRoot) ?? currentBranch(gitRoot)
  const base = resolveBaseRef(gitRoot)
  const mergeBase = resolveMergeBase(gitRoot, base)
  const diffArgs = [
    '--no-color',
    '--no-ext-diff',
    '--no-renames',
    '--relative',
    mergeBase,
  ]
  const statusResult = runGit(targetRoot, ['diff', '--name-status', ...diffArgs])
  const patchResult = runGit(targetRoot, ['diff', ...diffArgs])
  const named = parseNameStatus(
    statusResult.status === 0 ? statusResult.stdout : '',
  )
  const untracked = collectUntracked(targetRoot)
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

  return {
    available: true,
    branch,
    base,
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
  }
}
