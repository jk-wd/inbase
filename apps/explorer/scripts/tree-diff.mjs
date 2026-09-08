import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { toPosix } from './scan-ignore.mjs'
import { isBinaryFile, listSourceFiles } from './scan-target.mjs'

function splitLines(text) {
  if (text === '') return []
  const lines = text.split('\n')
  if (text.endsWith('\n')) lines.pop()
  return lines
}

function isInside(filePath, root) {
  if (!filePath || !root) return false
  const file = path.resolve(filePath)
  const base = path.resolve(root)
  return file === base || file.startsWith(base + path.sep)
}

function skipInside(root, skipRoot) {
  return isInside(skipRoot, root) ? path.resolve(skipRoot) : null
}

/** Snapshot copies are already filtered. Do not re-apply project gitignore. */
function listSnapshotFiles(root) {
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) return []
  const acc = []
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name)
      let stat = entry
      if (entry.isSymbolicLink()) {
        try {
          stat = fs.statSync(absolute)
        } catch {
          continue
        }
      }
      if (stat.isDirectory()) {
        walk(absolute)
        continue
      }
      if (!stat.isFile()) continue
      acc.push(toPosix(path.relative(root, absolute)))
    }
  }
  walk(root)
  return acc
}

export function snapshotSourceTree(fromRoot, toRoot, skipRoot = null) {
  if (fs.existsSync(toRoot)) fs.rmSync(toRoot, { recursive: true, force: true })
  fs.mkdirSync(toRoot, { recursive: true })
  const skip = skipInside(fromRoot, skipRoot) || skipInside(fromRoot, toRoot)
  for (const fileId of listSourceFiles(fromRoot, undefined, skip)) {
    const from = path.join(fromRoot, fileId)
    const to = path.join(toRoot, fileId)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  }
  return toRoot
}

function pruneEmptyDirs(root, filePath) {
  const base = path.resolve(root)
  let current = path.dirname(filePath)
  while (current.startsWith(`${base}${path.sep}`)) {
    if (!fs.existsSync(current)) {
      current = path.dirname(current)
      continue
    }
    if (fs.readdirSync(current).length > 0) break
    fs.rmdirSync(current)
    current = path.dirname(current)
  }
}

function sameFileContents(left, right) {
  try {
    return fs.readFileSync(left).equals(fs.readFileSync(right))
  } catch {
    return false
  }
}

/** Copy `fromRoot` onto `toRoot`, deleting files that are not in the snapshot. */
export function restoreSourceTree(fromRoot, toRoot, skipRoot = null) {
  if (!fromRoot || !fs.existsSync(fromRoot) || !fs.statSync(fromRoot).isDirectory()) {
    return []
  }
  if (!toRoot || !fs.existsSync(toRoot) || !fs.statSync(toRoot).isDirectory()) {
    return []
  }
  const skip = skipInside(toRoot, skipRoot) || skipInside(toRoot, fromRoot)
  const before = new Set(listSnapshotFiles(fromRoot))
  const after = new Set(listSourceFiles(toRoot, undefined, skip))
  const changed = []
  for (const fileId of after) {
    if (before.has(fileId)) continue
    const absolute = path.join(toRoot, fileId)
    fs.rmSync(absolute, { force: true })
    pruneEmptyDirs(toRoot, absolute)
    changed.push(fileId)
  }
  for (const fileId of before) {
    const from = path.join(fromRoot, fileId)
    const to = path.join(toRoot, fileId)
    if (after.has(fileId) && sameFileContents(from, to)) continue
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
    changed.push(fileId)
  }
  return changed
}

function fileAsAddPatch(fileId, contents) {
  const lines = splitLines(contents)
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

function fileAsDeletePatch(fileId, contents) {
  const lines = splitLines(contents)
  const count = lines.length
  const hunk =
    count === 0
      ? []
      : [`@@ -1,${count} +0,0 @@`, ...lines.map((line) => `-${line}`)]
  return [
    `diff --git a/${fileId} b/${fileId}`,
    'deleted file mode 100644',
    `--- a/${fileId}`,
    '+++ /dev/null',
    ...hunk,
    '',
  ].join('\n')
}

function rewriteGitPaths(patch, fileId) {
  return patch
    .split('\n')
    .map((line) => {
      if (line.startsWith('diff --git ')) {
        return `diff --git a/${fileId} b/${fileId}`
      }
      if (line.startsWith('--- ')) {
        return line.includes('/dev/null') ? '--- /dev/null' : `--- a/${fileId}`
      }
      if (line.startsWith('+++ ')) {
        return line.includes('/dev/null') ? '+++ /dev/null' : `+++ b/${fileId}`
      }
      return line
    })
    .join('\n')
}

function gitFileDiff(beforePath, afterPath, fileId) {
  const result = spawnSync(
    'git',
    ['diff', '--no-index', '--no-color', '--no-ext-diff', '--', beforePath, afterPath],
    {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  )
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(result.stderr?.trim() || `git diff failed for ${fileId}`)
  }
  const stdout = result.stdout?.trimEnd()
  if (!stdout) return ''
  return `${rewriteGitPaths(stdout, fileId).trimEnd()}\n`
}

export function diffSourceTrees(beforeRoot, afterRoot, skipRoot = null) {
  const before = new Set(listSnapshotFiles(beforeRoot))
  const skip = skipInside(afterRoot, skipRoot) || skipInside(afterRoot, beforeRoot)
  const after = new Set(listSourceFiles(afterRoot, undefined, skip))
  const ids = [...new Set([...before, ...after])].sort((left, right) =>
    left.localeCompare(right),
  )
  const parts = []
  for (const fileId of ids) {
    const beforePath = path.join(beforeRoot, fileId)
    const afterPath = path.join(afterRoot, fileId)
    const had = before.has(fileId)
    const has = after.has(fileId)
    if (!had && has) {
      if (isBinaryFile(afterPath)) continue
      parts.push(fileAsAddPatch(fileId, fs.readFileSync(afterPath, 'utf8')))
      continue
    }
    if (had && !has) {
      if (isBinaryFile(beforePath)) continue
      parts.push(fileAsDeletePatch(fileId, fs.readFileSync(beforePath, 'utf8')))
      continue
    }
    if (isBinaryFile(beforePath) || isBinaryFile(afterPath)) continue
    const beforeText = fs.readFileSync(beforePath, 'utf8')
    const afterText = fs.readFileSync(afterPath, 'utf8')
    if (beforeText === afterText) continue
    const patch = gitFileDiff(beforePath, afterPath, fileId)
    if (patch) parts.push(patch)
  }
  return parts.join('\n')
}
