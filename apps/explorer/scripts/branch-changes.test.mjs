import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { emptyBranchChanges, readBranchChanges } from './branch-changes.mjs'
import { initGitRepo } from './git-test.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function runGit(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 'Visualizer Test',
      GIT_AUTHOR_EMAIL: 'visualizer-test@example.com',
      GIT_COMMITTER_NAME: 'Visualizer Test',
      GIT_COMMITTER_EMAIL: 'visualizer-test@example.com',
    },
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result
}

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
  assert.deepEqual(empty.files, [])
  assert.deepEqual(empty.creates, [])
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
