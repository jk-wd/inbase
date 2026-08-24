import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { listSourceFiles } from './scan-target.mjs'

function splitLines(text) {
  if (text === '') return []
  const lines = text.split('\n')
  if (text.endsWith('\n')) lines.pop()
  return lines
}

export function snapshotSourceTree(fromRoot, toRoot) {
  if (fs.existsSync(toRoot)) fs.rmSync(toRoot, { recursive: true, force: true })
  fs.mkdirSync(toRoot, { recursive: true })
  for (const fileId of listSourceFiles(fromRoot)) {
    const from = path.join(fromRoot, fileId)
    const to = path.join(toRoot, fileId)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  }
  return toRoot
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

export function diffSourceTrees(beforeRoot, afterRoot) {
  const before = new Set(listSourceFiles(beforeRoot))
  const after = new Set(listSourceFiles(afterRoot))
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
      parts.push(fileAsAddPatch(fileId, fs.readFileSync(afterPath, 'utf8')))
      continue
    }
    if (had && !has) {
      parts.push(fileAsDeletePatch(fileId, fs.readFileSync(beforePath, 'utf8')))
      continue
    }
    const beforeText = fs.readFileSync(beforePath, 'utf8')
    const afterText = fs.readFileSync(afterPath, 'utf8')
    if (beforeText === afterText) continue
    const patch = gitFileDiff(beforePath, afterPath, fileId)
    if (patch) parts.push(patch)
  }
  return parts.join('\n')
}
