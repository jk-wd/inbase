import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  isWorkspaceDevSwitcherEnabled,
  listWorkspaceTargets,
  matchWorkspaceTargetId,
  readPersistedTargetId,
  resolveDataDir,
  resolveInitialTargetRoot,
  resolveTargetPathPrefix,
  resolveTargetRoot,
  writePersistedTargetId,
} from './target-config.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const explorerRoot = path.resolve(here, '..')
const defaultTarget = path.resolve(explorerRoot, '../example-target')
const defaultDataDir = path.resolve(explorerRoot, 'src/data')
const repoRoot = path.resolve(explorerRoot, '../..')

test('defaults to apps/example-target', () => {
  assert.equal(resolveTargetRoot(''), defaultTarget)
  assert.equal(resolveTargetRoot(undefined), defaultTarget)
})

test('resolves absolute and cwd-relative target paths', () => {
  assert.equal(resolveTargetRoot('/tmp/other-app'), path.normalize('/tmp/other-app'))
  assert.equal(resolveTargetRoot('apps/example-target'), path.resolve(process.cwd(), 'apps/example-target'))
})

test('strips an in-repo path prefix from patch paths', () => {
  assert.equal(resolveTargetPathPrefix(defaultTarget), 'apps/example-target/')
  assert.equal(resolveTargetPathPrefix(path.join(repoRoot, 'apps/explorer')), 'apps/explorer/')
})

test('leaves targets outside the repo without a prefix', () => {
  assert.equal(resolveTargetPathPrefix('/tmp/other-app'), null)
})

test('the complete repo has no path prefix', () => {
  assert.equal(resolveTargetPathPrefix(repoRoot), null)
})

test('lists example apps and the complete repo, skipping explorer', () => {
  const targets = listWorkspaceTargets()
  assert.deepEqual(
    targets.map((target) => target.id),
    ['example-target', 'repo'],
  )
  assert.equal(targets[0].label, 'Example target')
  assert.equal(targets[0].root, defaultTarget)
  assert.equal(targets[1].label, 'Complete repo')
  assert.equal(targets[1].root, repoRoot)
})

test('discovers later example apps under apps/', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbase-apps-'))
  try {
    fs.mkdirSync(path.join(root, 'apps/example-target'), { recursive: true })
    fs.mkdirSync(path.join(root, 'apps/explorer'), { recursive: true })
    fs.mkdirSync(path.join(root, 'apps/example-shop'), { recursive: true })
    const targets = listWorkspaceTargets({
      appsRoot: path.join(root, 'apps'),
      repositoryRoot: root,
    })
    assert.deepEqual(
      targets.map((target) => ({ id: target.id, label: target.label })),
      [
        { id: 'example-target', label: 'Example target' },
        { id: 'example-shop', label: 'Example Shop' },
        { id: 'repo', label: 'Complete repo' },
      ],
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('matches a workspace target id from its root', () => {
  const targets = listWorkspaceTargets()
  assert.equal(matchWorkspaceTargetId(defaultTarget, targets), 'example-target')
  assert.equal(matchWorkspaceTargetId(repoRoot, targets), 'repo')
  assert.equal(matchWorkspaceTargetId('/tmp/other-app', targets), null)
})

test('enables the switcher only for explorer src/data with the demo app present', () => {
  assert.equal(
    isWorkspaceDevSwitcherEnabled({
      exampleTarget: defaultTarget,
      resolvedDataDir: defaultDataDir,
      explorerDataDir: defaultDataDir,
    }),
    true,
  )
  assert.equal(
    isWorkspaceDevSwitcherEnabled({
      exampleTarget: defaultTarget,
      resolvedDataDir: path.join(repoRoot, '.inbase'),
      explorerDataDir: defaultDataDir,
    }),
    false,
  )
  assert.equal(
    isWorkspaceDevSwitcherEnabled({
      exampleTarget: '/tmp/missing-example-target',
      resolvedDataDir: defaultDataDir,
      explorerDataDir: defaultDataDir,
    }),
    false,
  )
})

test('restores a persisted workspace target when the switcher is on', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbase-persist-'))
  try {
    writePersistedTargetId('repo', dir)
    assert.equal(readPersistedTargetId(dir), 'repo')
    const targets = listWorkspaceTargets()
    assert.equal(
      resolveInitialTargetRoot({
        envTarget: '',
        persistedId: 'repo',
        switcherEnabled: true,
        targets,
        fallback: defaultTarget,
      }),
      repoRoot,
    )
    assert.equal(
      resolveInitialTargetRoot({
        envTarget: '/tmp/other-app',
        persistedId: 'repo',
        switcherEnabled: true,
        targets,
        fallback: defaultTarget,
      }),
      path.normalize('/tmp/other-app'),
    )
    assert.equal(
      resolveInitialTargetRoot({
        envTarget: '',
        persistedId: 'repo',
        switcherEnabled: false,
        targets,
        fallback: defaultTarget,
      }),
      defaultTarget,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('defaults data dir to explorer src/data', () => {
  assert.equal(resolveDataDir(''), defaultDataDir)
  assert.equal(resolveDataDir(undefined), defaultDataDir)
})

test('resolves absolute and cwd-relative data dirs', () => {
  assert.equal(resolveDataDir('/tmp/inbase-data'), path.normalize('/tmp/inbase-data'))
  assert.equal(resolveDataDir('.inbase'), path.resolve(process.cwd(), '.inbase'))
})
