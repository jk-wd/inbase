import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  emptyBranchChanges,
  normalizeBranchChangesMode,
  readBranchChanges,
} from './branch-changes.mjs'
import { initGitRepo, runGit } from './git-test.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function fixture(nestedTarget = false) {
  const root = fs.mkdtempSync(path.join(repoRoot, '.tmp-branch-'))
  const repo = path.join(root, 'repo')
  const targetRoot = nestedTarget ? path.join(repo, 'apps', 'demo') : repo
  fs.mkdirSync(path.join(targetRoot, 'src'), { recursive: true })
  fs.writeFileSync(
    path.join(targetRoot, 'src/a.ts'),
    'export function greet() {\n  return 1\n}\n',
  )
  fs.writeFileSync(path.join(targetRoot, 'src/keep.ts'), 'export const keep = true\n')
  initGitRepo(repo)
  runGit(repo, ['add', '.'])
  runGit(repo, ['commit', '-m', 'base'])
  return {
    root,
    repo,
    targetRoot,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}

test('empty branch changes are unavailable', () => {
  const empty = emptyBranchChanges()
  assert.equal(empty.available, false)
  assert.equal(empty.mode, 'main')
  assert.equal(empty.remoteMissing, false)
  assert.deepEqual(empty.files, [])
  assert.deepEqual(empty.creates, [])
})

test('normalizes branch comparison modes', () => {
  assert.equal(normalizeBranchChangesMode('remote'), 'remote')
  assert.equal(normalizeBranchChangesMode('main'), 'main')
  assert.equal(normalizeBranchChangesMode('other'), 'main')
  assert.equal(normalizeBranchChangesMode(undefined), 'main')
})

test('returns unavailable outside a git repo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-coder-nogit-'))
  try {
    const changes = readBranchChanges(root)
    assert.equal(changes.available, false)
    assert.equal(changes.branch, null)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('reads committed, unstaged, and untracked changes on a branch', () => {
  const env = fixture()
  try {
    runGit(env.repo, ['checkout', '-b', 'feature/clock'])
    fs.writeFileSync(
      path.join(env.targetRoot, 'src/a.ts'),
      'export function greet() {\n  return 2\n}\n',
    )
    fs.writeFileSync(
      path.join(env.targetRoot, 'src/Clock.tsx'),
      'export function Clock() {\n  return null\n}\n',
    )
    fs.rmSync(path.join(env.targetRoot, 'src/keep.ts'))
    runGit(env.repo, ['add', '.'])
    runGit(env.repo, ['commit', '-m', 'committed branch work'])
    fs.writeFileSync(
      path.join(env.targetRoot, 'src/a.ts'),
      'export function greet() {\n  return 3\n}\nexport const extra = 1\n',
    )
    fs.writeFileSync(
      path.join(env.targetRoot, 'src/Draft.ts'),
      'export function Draft() {\n  return true\n}\n',
    )

    const changes = readBranchChanges(env.targetRoot, ['src/a.ts', 'src/keep.ts'])
    assert.equal(changes.available, true)
    assert.equal(changes.mode, 'main')
    assert.equal(changes.branch, 'feature/clock')
    assert.equal(changes.base, 'main')
    assert.deepEqual(changes.files, ['src/a.ts'])
    assert.deepEqual(changes.creates.sort(), ['src/Clock.tsx', 'src/Draft.ts'])
    assert.deepEqual(changes.deletes, ['src/keep.ts'])
    assert.deepEqual(changes.addedFunctions, [
      { name: 'Clock', file: 'src/Clock.tsx' },
      { name: 'Draft', file: 'src/Draft.ts' },
    ])
    assert.deepEqual(changes.changedFunctions, [
      { name: 'greet', file: 'src/a.ts' },
    ])
    assert.deepEqual(changes.addedVariables, [
      { name: 'extra', file: 'src/a.ts' },
    ])
  } finally {
    env.cleanup()
  }
})

test('limits branch changes to a nested target folder', () => {
  const env = fixture(true)
  try {
    fs.writeFileSync(path.join(env.repo, 'outside.ts'), 'export const skip = 1\n')
    runGit(env.repo, ['add', 'outside.ts'])
    runGit(env.repo, ['commit', '-m', 'outside the mapped target'])
    runGit(env.repo, ['checkout', '-b', 'feature/nested'])
    fs.writeFileSync(path.join(env.repo, 'outside.ts'), 'export const skip = 2\n')
    fs.writeFileSync(
      path.join(env.targetRoot, 'src/a.ts'),
      'export function greet() {\n  return 9\n}\n',
    )
    fs.writeFileSync(path.join(env.targetRoot, 'src/New.ts'), 'export const n = 1\n')

    const changes = readBranchChanges(env.targetRoot, ['src/a.ts'])
    assert.equal(changes.available, true)
    assert.deepEqual(changes.files, ['src/a.ts'])
    assert.deepEqual(changes.creates, ['src/New.ts'])
    assert.ok(!changes.files.includes('outside.ts'))
    assert.ok(!changes.creates.includes('outside.ts'))
  } finally {
    env.cleanup()
  }
})

test('remote mode compares staged files to origin of the same branch', () => {
  const env = fixture()
  try {
    runGit(env.repo, ['checkout', '-b', 'feature/clock'])
    fs.writeFileSync(
      path.join(env.targetRoot, 'src/Clock.tsx'),
      'export function Clock() {\n  return null\n}\n',
    )
    runGit(env.repo, ['add', 'src/Clock.tsx'])
    runGit(env.repo, ['commit', '-m', 'pushed branch work'])
    const pushed = runGit(env.repo, ['rev-parse', 'HEAD']).stdout.trim()
    runGit(env.repo, ['update-ref', 'refs/remotes/origin/feature/clock', pushed])

    fs.writeFileSync(
      path.join(env.targetRoot, 'src/a.ts'),
      'export function greet() {\n  return 2\n}\n',
    )
    runGit(env.repo, ['add', 'src/a.ts'])
    fs.writeFileSync(
      path.join(env.targetRoot, 'src/a.ts'),
      'export function greet() {\n  return 3\n}\nexport const extra = 1\n',
    )
    fs.writeFileSync(
      path.join(env.targetRoot, 'src/Draft.ts'),
      'export function Draft() {\n  return true\n}\n',
    )
    fs.rmSync(path.join(env.targetRoot, 'src/keep.ts'))

    const remote = readBranchChanges(
      env.targetRoot,
      ['src/a.ts', 'src/keep.ts'],
      'remote',
    )
    assert.equal(remote.available, true)
    assert.equal(remote.mode, 'remote')
    assert.equal(remote.remoteMissing, false)
    assert.equal(remote.branch, 'feature/clock')
    assert.equal(remote.base, 'origin/feature/clock')
    assert.deepEqual(remote.files, ['src/a.ts'])
    assert.deepEqual(remote.creates, [])
    assert.deepEqual(remote.deletes, [])
    assert.deepEqual(remote.changedFunctions, [
      { name: 'greet', file: 'src/a.ts' },
    ])
    assert.deepEqual(remote.addedVariables, [])
    assert.deepEqual(remote.addedFunctions, [])

    const vsMain = readBranchChanges(env.targetRoot, ['src/a.ts', 'src/keep.ts'])
    assert.equal(vsMain.mode, 'main')
    assert.deepEqual(vsMain.files, ['src/a.ts'])
    assert.deepEqual(vsMain.creates.sort(), ['src/Clock.tsx', 'src/Draft.ts'])
    assert.deepEqual(vsMain.deletes, ['src/keep.ts'])
    assert.deepEqual(vsMain.addedVariables, [
      { name: 'extra', file: 'src/a.ts' },
    ])
  } finally {
    env.cleanup()
  }
})

test('remote mode includes unpushed commits and staged files', () => {
  const env = fixture()
  try {
    runGit(env.repo, ['checkout', '-b', 'feature/clock'])
    const originSha = runGit(env.repo, ['rev-parse', 'HEAD']).stdout.trim()
    runGit(env.repo, ['update-ref', 'refs/remotes/origin/feature/clock', originSha])
    fs.writeFileSync(
      path.join(env.targetRoot, 'src/Clock.tsx'),
      'export function Clock() {\n  return null\n}\n',
    )
    runGit(env.repo, ['add', 'src/Clock.tsx'])
    runGit(env.repo, ['commit', '-m', 'unpushed'])
    fs.writeFileSync(
      path.join(env.targetRoot, 'src/a.ts'),
      'export function greet() {\n  return 2\n}\n',
    )
    runGit(env.repo, ['add', 'src/a.ts'])

    const remote = readBranchChanges(
      env.targetRoot,
      ['src/a.ts', 'src/keep.ts'],
      'remote',
    )
    assert.equal(remote.base, 'origin/feature/clock')
    assert.deepEqual(remote.files, ['src/a.ts'])
    assert.deepEqual(remote.creates, ['src/Clock.tsx'])
  } finally {
    env.cleanup()
  }
})

test('remote mode reports a missing upstream', () => {
  const env = fixture()
  try {
    runGit(env.repo, ['checkout', '-b', 'feature/clock'])
    const remote = readBranchChanges(env.targetRoot, ['src/a.ts'], 'remote')
    assert.equal(remote.available, true)
    assert.equal(remote.mode, 'remote')
    assert.equal(remote.remoteMissing, true)
    assert.equal(remote.base, null)
    assert.deepEqual(remote.files, [])
    assert.deepEqual(remote.creates, [])
  } finally {
    env.cleanup()
  }
})
