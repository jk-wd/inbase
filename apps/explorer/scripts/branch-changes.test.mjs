import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  emptyBranchChanges,
  normalizeBranchChangesBase,
  readBranchChanges,
  readWorkingTreeChanges,
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
  assert.equal(empty.current, true)
  assert.equal(empty.baseMissing, false)
  assert.deepEqual(empty.files, [])
  assert.deepEqual(empty.creates, [])
  assert.deepEqual(empty.branches, [])
})

test('normalizes a comparison branch', () => {
  assert.equal(normalizeBranchChangesBase('origin/main'), 'origin/main')
  assert.equal(normalizeBranchChangesBase('feature/clock'), 'feature/clock')
  assert.equal(normalizeBranchChangesBase('HEAD'), null)
  assert.equal(normalizeBranchChangesBase(''), null)
  assert.equal(normalizeBranchChangesBase('  main  '), 'main')
  assert.equal(normalizeBranchChangesBase('-bad'), null)
  assert.equal(normalizeBranchChangesBase(undefined), null)
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

test('defaults to uncommitted working-tree changes vs last commit', () => {
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

    const changes = readBranchChanges(env.targetRoot, [
      'src/a.ts',
      'src/keep.ts',
      'src/Clock.tsx',
    ])
    assert.equal(changes.available, true)
    assert.equal(changes.current, true)
    assert.equal(changes.branch, 'feature/clock')
    assert.equal(changes.base, 'feature/clock')
    assert.deepEqual(changes.files, ['src/a.ts'])
    assert.deepEqual(changes.creates, ['src/Draft.ts'])
    assert.deepEqual(changes.deletes, [])
    assert.ok(!changes.creates.includes('src/Clock.tsx'))
    assert.ok(changes.branches.some((item) => item.name === 'main' && !item.remote))
    assert.ok(!changes.branches.some((item) => item.name === 'feature/clock'))
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

test('comparing against another local branch includes committed work', () => {
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

    const changes = readBranchChanges(
      env.targetRoot,
      ['src/a.ts', 'src/keep.ts'],
      'main',
    )
    assert.equal(changes.available, true)
    assert.equal(changes.current, false)
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

test('comparing against a remote branch uses that ref', () => {
  const env = fixture()
  try {
    runGit(env.repo, ['checkout', '-b', 'feature/clock'])
    const originSha = runGit(env.repo, ['rev-parse', 'HEAD']).stdout.trim()
    runGit(env.repo, ['update-ref', 'refs/remotes/origin/main', originSha])
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
    fs.writeFileSync(
      path.join(env.targetRoot, 'src/Draft.ts'),
      'export function Draft() {\n  return true\n}\n',
    )

    const remote = readBranchChanges(
      env.targetRoot,
      ['src/a.ts', 'src/keep.ts'],
      'origin/main',
    )
    assert.equal(remote.current, false)
    assert.equal(remote.base, 'origin/main')
    assert.equal(remote.baseMissing, false)
    assert.ok(remote.branches.some((item) => item.name === 'origin/main' && item.remote))
    assert.ok(remote.branches.some((item) => item.name === 'main' && !item.remote))
    assert.deepEqual(remote.files, ['src/a.ts'])
    assert.deepEqual(remote.creates.sort(), ['src/Clock.tsx', 'src/Draft.ts'])
  } finally {
    env.cleanup()
  }
})

test('a missing comparison branch falls back to last commit', () => {
  const env = fixture()
  try {
    runGit(env.repo, ['checkout', '-b', 'feature/clock'])
    fs.writeFileSync(
      path.join(env.targetRoot, 'src/Draft.ts'),
      'export function Draft() {\n  return true\n}\n',
    )
    const missing = readBranchChanges(env.targetRoot, ['src/a.ts'], 'no-such-branch')
    assert.equal(missing.available, true)
    assert.equal(missing.current, true)
    assert.equal(missing.baseMissing, true)
    assert.equal(missing.base, 'feature/clock')
    assert.deepEqual(missing.creates, ['src/Draft.ts'])
  } finally {
    env.cleanup()
  }
})

test('selecting the current branch is last commit', () => {
  const env = fixture()
  try {
    runGit(env.repo, ['checkout', '-b', 'feature/clock'])
    fs.writeFileSync(
      path.join(env.targetRoot, 'src/Clock.tsx'),
      'export function Clock() {\n  return null\n}\n',
    )
    runGit(env.repo, ['add', 'src/Clock.tsx'])
    runGit(env.repo, ['commit', '-m', 'committed'])
    fs.writeFileSync(
      path.join(env.targetRoot, 'src/Draft.ts'),
      'export function Draft() {\n  return true\n}\n',
    )
    const changes = readBranchChanges(
      env.targetRoot,
      ['src/a.ts', 'src/Clock.tsx'],
      'feature/clock',
    )
    assert.equal(changes.current, true)
    assert.equal(changes.base, 'feature/clock')
    assert.deepEqual(changes.creates, ['src/Draft.ts'])
    assert.ok(!changes.creates.includes('src/Clock.tsx'))
  } finally {
    env.cleanup()
  }
})

test('deleted untracked mapped file is absent, not still created', () => {
  const env = fixture()
  try {
    fs.writeFileSync(
      path.join(env.targetRoot, 'src/randomColor.ts'),
      'export const randomColor = () => "#fff"\n',
    )
    fs.writeFileSync(
      path.join(env.targetRoot, 'src/a.ts'),
      'export function greet() {\n  return 2\n}\n',
    )

    const whilePresent = readWorkingTreeChanges(env.targetRoot, [
      'src/a.ts',
      'src/keep.ts',
      'src/randomColor.ts',
    ])
    assert.ok(whilePresent.creates.includes('src/randomColor.ts'))
    assert.deepEqual(whilePresent.absent, [])

    fs.rmSync(path.join(env.targetRoot, 'src/randomColor.ts'))

    const afterDelete = readWorkingTreeChanges(env.targetRoot, [
      'src/a.ts',
      'src/keep.ts',
      'src/randomColor.ts',
    ])
    assert.ok(!afterDelete.creates.includes('src/randomColor.ts'))
    assert.ok(!afterDelete.deletes.includes('src/randomColor.ts'))
    assert.deepEqual(afterDelete.absent, ['src/randomColor.ts'])
    assert.ok(afterDelete.files.includes('src/a.ts'))
  } finally {
    env.cleanup()
  }
})

test('tracked deletes still show as deletes, not absent', () => {
  const env = fixture()
  try {
    fs.rmSync(path.join(env.targetRoot, 'src/keep.ts'))
    const changes = readWorkingTreeChanges(env.targetRoot, [
      'src/a.ts',
      'src/keep.ts',
    ])
    assert.deepEqual(changes.deletes, ['src/keep.ts'])
    assert.ok(!changes.absent.includes('src/keep.ts'))
  } finally {
    env.cleanup()
  }
})
