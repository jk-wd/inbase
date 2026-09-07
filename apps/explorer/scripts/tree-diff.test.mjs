import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parseUnifiedPatch } from './patch-lib.mjs'
import { diffSourceTrees, snapshotSourceTree } from './tree-diff.mjs'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbase-tree-diff-'))
  const before = path.join(root, 'before')
  const after = path.join(root, 'after')
  fs.mkdirSync(path.join(before, 'src'), { recursive: true })
  fs.writeFileSync(path.join(before, 'src/a.ts'), 'export const value = 1\n')
  fs.writeFileSync(path.join(before, 'src/keep.ts'), 'export const keep = true\n')
  return {
    root,
    before,
    after,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}

test('snapshots source files and diffs adds, edits, and deletes', () => {
  const env = fixture()
  try {
    snapshotSourceTree(env.before, env.after)
    fs.writeFileSync(path.join(env.after, 'src/a.ts'), 'export const value = 2\n')
    fs.writeFileSync(path.join(env.after, 'src/Clock.tsx'), 'export function Clock() {}\n')
    fs.rmSync(path.join(env.after, 'src/keep.ts'))

    const patch = diffSourceTrees(env.before, env.after)
    const parsed = parseUnifiedPatch(patch)
    assert.deepEqual(parsed.files.sort(), ['src/a.ts'])
    assert.deepEqual(parsed.creates.sort(), ['src/Clock.tsx'])
    assert.deepEqual(parsed.deletes.sort(), ['src/keep.ts'])
    assert.match(patch, /export const value = 2/)
    assert.match(patch, /export function Clock/)
  } finally {
    env.cleanup()
  }
})

test('returns an empty patch when the trees match', () => {
  const env = fixture()
  try {
    snapshotSourceTree(env.before, env.after)
    assert.equal(diffSourceTrees(env.before, env.after), '')
  } finally {
    env.cleanup()
  }
})

test('does not treat invoke snapshot copies inside the target as added files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbase-tree-diff-datadir-'))
  const dataDir = path.join(root, 'apps/explorer/src/data')
  const preStep = path.join(dataDir, 'diff-sessions/amber/pre-step')
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const value = 1\n')
    fs.writeFileSync(path.join(root, 'src/keep.ts'), 'export const keep = true\n')
    fs.writeFileSync(path.join(dataDir, 'codebase.json'), '{}\n')

    snapshotSourceTree(root, preStep, dataDir)
    assert.equal(diffSourceTrees(preStep, root, dataDir), '')

    fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const value = 2\n')
    const parsed = parseUnifiedPatch(diffSourceTrees(preStep, root, dataDir))
    assert.deepEqual(parsed.files, ['src/a.ts'])
    assert.deepEqual(parsed.creates, [])
    assert.deepEqual(parsed.deletes, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('still diffs a snapshot stored in a gitignored data dir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbase-tree-diff-ignore-'))
  const dataDir = path.join(root, '.inbase')
  const preStep = path.join(dataDir, 'diff-sessions/amber/pre-step')
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, '.gitignore'), '.inbase\n')
    fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const value = 1\n')
    fs.writeFileSync(path.join(root, 'src/keep.ts'), 'export const keep = true\n')

    snapshotSourceTree(root, preStep, dataDir)
    assert.equal(diffSourceTrees(preStep, root, dataDir), '')

    fs.writeFileSync(path.join(root, 'src/Clock.tsx'), 'export function Clock() {}\n')
    const parsed = parseUnifiedPatch(diffSourceTrees(preStep, root, dataDir))
    assert.deepEqual(parsed.creates, ['src/Clock.tsx'])
    assert.deepEqual(parsed.files, [])
    assert.ok(!parsed.creates.includes('src/a.ts'))
    assert.ok(!parsed.creates.includes('src/keep.ts'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
