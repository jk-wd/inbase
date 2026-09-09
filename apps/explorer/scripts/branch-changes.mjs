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
import { dropMassKnownCreates, emptyChangeOverlay } from './change-overlay.mjs'
import { shouldIgnoreRelativePath, toPosix } from './scan-ignore.mjs'

const BINARY_PROBE_BYTES = 8000
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const BRANCH_COMMIT_LIMIT = 80

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

export function normalizeBranchChangesMode(value) {
  if (value === 'remote' || value === 'current' || value === 'commit') return value
  return 'main'
}

export function normalizeBranchChangesCommit(value) {
  if (typeof value !== 'string') return null
  const sha = value.trim().toLowerCase()
  if (!/^[0-9a-f]{4,40}$/.test(sha)) return null
  return sha
}

function parseCommitLog(text) {
  const commits = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const first = line.indexOf('\t')
    if (first < 0) continue
    const second = line.indexOf('\t', first + 1)
    if (second < 0) continue
    const sha = line.slice(0, first).trim()
    const short = line.slice(first + 1, second).trim()
    const subject = line.slice(second + 1).trim()
    if (!sha || !short) continue
    commits.push({ sha, short, subject })
  }
  return commits
}

function gitLogCommits(gitRoot, extraArgs) {
  const result = runGit(gitRoot, [
    'log',
    '--format=%H%x09%h%x09%s',
    '--first-parent',
    '-n',
    String(BRANCH_COMMIT_LIMIT),
    ...extraArgs,
  ])
  if (result.status !== 0) return []
  return parseCommitLog(result.stdout)
}

export function listBranchCommits(targetRoot) {
  if (!targetRoot || !fs.existsSync(targetRoot)) return []
  const gitRoot = gitTopLevel(targetRoot)
  if (!gitRoot) return []
  const mergeBase = resolveMergeBase(gitRoot, resolveBaseRef(gitRoot))
  const unique = gitLogCommits(gitRoot, ['HEAD', '--not', mergeBase])
  if (unique.length > 0) return unique
  return gitLogCommits(gitRoot, ['HEAD'])
}

function firstParentSha(gitRoot, sha) {
  const result = runGit(gitRoot, [
    'rev-parse',
    '--verify',
    '--quiet',
    `${sha}^`,
  ])
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim()
  return null
}

function resolveCommitOnBranch(gitRoot, commits, commitInput) {
  const requested = normalizeBranchChangesCommit(commitInput)
  if (requested) {
    const listed = commits.find(
      (commit) =>
        commit.sha.startsWith(requested) || requested.startsWith(commit.sha),
    )
    if (listed) return listed
    const resolved = runGit(gitRoot, [
      'rev-parse',
      '--verify',
      '--quiet',
      requested,
    ])
    const sha = resolved.status === 0 ? resolved.stdout.trim() : ''
    if (sha) {
      const ancestor = runGit(gitRoot, [
        'merge-base',
        '--is-ancestor',
        sha,
        'HEAD',
      ])
      if (ancestor.status === 0) {
        const short = runGit(gitRoot, ['rev-parse', '--short', sha])
        const subject = runGit(gitRoot, ['log', '-1', '--format=%s', sha])
        return {
          sha,
          short:
            short.status === 0 && short.stdout.trim()
              ? short.stdout.trim()
              : sha.slice(0, 7),
          subject: subject.status === 0 ? subject.stdout.trim() : '',
        }
      }
    }
  }
  return commits[0] ?? null
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

function resolveRemoteRef(gitRoot, branch) {
  const upstream = runGit(gitRoot, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ])
  if (upstream.status === 0) {
    const ref = upstream.stdout.trim()
    if (ref) return ref
  }
  if (branch && branch !== 'HEAD') {
    const candidate = `origin/${branch}`
    const check = runGit(gitRoot, ['rev-parse', '--verify', '--quiet', candidate])
    if (check.status === 0 && check.stdout.trim()) return candidate
  }
  return null
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
    mode: 'main',
    remoteMissing: false,
    commit: null,
    commits: [],
    commitMissing: false,
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
  return {
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

export function readBranchChanges(
  targetRoot,
  knownFileIds = [],
  modeInput = 'main',
  commitInput = null,
) {
  const empty = emptyBranchChanges()
  const mode = normalizeBranchChangesMode(modeInput)
  if (!targetRoot || !fs.existsSync(targetRoot)) return { ...empty, mode }
  const gitRoot = gitTopLevel(targetRoot)
  if (!gitRoot) return { ...empty, mode }

  const branch = currentBranch(targetRoot) ?? currentBranch(gitRoot)
  if (mode === 'commit') {
    const commits = listBranchCommits(targetRoot)
    const commit = resolveCommitOnBranch(gitRoot, commits, commitInput)
    if (!commit) {
      return {
        ...empty,
        available: true,
        branch,
        mode,
        commitMissing: true,
        commits,
      }
    }
    const parent = firstParentSha(gitRoot, commit.sha)
    const listed = commits.some((item) => item.sha === commit.sha)
      ? commits
      : [commit, ...commits]
    return {
      available: true,
      branch,
      base: commit.short,
      mode,
      remoteMissing: false,
      commit,
      commits: listed,
      commitMissing: false,
      ...collectDiff(
        targetRoot,
        knownFileIds,
        [
          '--no-color',
          '--no-ext-diff',
          '--no-renames',
          '--relative',
          parent ?? EMPTY_TREE,
          commit.sha,
        ],
        false,
      ),
    }
  }
  if (mode === 'current') {
    return {
      available: true,
      branch,
      base: 'HEAD',
      mode,
      remoteMissing: false,
      ...readWorkingTreeChanges(targetRoot, knownFileIds),
    }
  }
  if (mode === 'remote') {
    const remote = resolveRemoteRef(gitRoot, branch)
    if (!remote) {
      return {
        ...empty,
        available: true,
        branch,
        base: null,
        mode,
        remoteMissing: true,
      }
    }
    return {
      available: true,
      branch,
      base: remote,
      mode,
      remoteMissing: false,
      ...collectDiff(
        targetRoot,
        knownFileIds,
        [
          '--cached',
          '--no-color',
          '--no-ext-diff',
          '--no-renames',
          '--relative',
          remote,
        ],
        false,
      ),
    }
  }

  const base = resolveBaseRef(gitRoot)
  const mergeBase = resolveMergeBase(gitRoot, base)
  return {
    available: true,
    branch,
    base,
    mode,
    remoteMissing: false,
    ...collectDiff(
      targetRoot,
      knownFileIds,
      ['--no-color', '--no-ext-diff', '--no-renames', '--relative', mergeBase],
      true,
    ),
  }
}
