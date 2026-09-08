import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  applyTargetRoot,
  isWorkspaceDevSwitcherEnabled,
  listWorkspaceTargets,
  matchWorkspaceTargetId,
  projectsState,
  readPersistedTargetId,
  readRegisteredProjects,
  registerProject,
  resolveDataDir,
  resolveInitialTargetRoot,
  resolveTargetPathPrefix,
  resolveTargetRoot,
  selectProject,
  targetRoot,
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
    assert.equal(
      resolveInitialTargetRoot({
        envTarget: '',
        persistedId: 'repo',
        switcherEnabled: false,
        targets,
        fallback: defaultTarget,
        configTarget: '/tmp/from-config',
      }),
      path.normalize('/tmp/from-config'),
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

test('registers projects in an isolated data dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbase-projects-'))
  const first = path.join(dir, 'apps/alpha')
  const second = path.join(dir, 'apps/beta')
  fs.mkdirSync(first, { recursive: true })
  fs.mkdirSync(second, { recursive: true })
  try {
    registerProject(first, { dir, select: false })
    registerProject(second, { dir, select: false })
    const state = readRegisteredProjects(dir)
    assert.deepEqual(
      state.projects.map((project) => project.label),
      ['Alpha', 'Beta'],
    )
    assert.equal(state.projects[0].root, path.resolve(first))
    assert.equal(projectsState({ dir }).enabled, true)
    assert.equal(projectsState({ dir }).targets.length, 2)
    assert.equal(fs.existsSync(path.join(dir, 'projects.json')), true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('disambiguates registered projects that share a folder name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbase-projects-'))
  const first = path.join(dir, 'one/app')
  const second = path.join(dir, 'two/app')
  fs.mkdirSync(first, { recursive: true })
  fs.mkdirSync(second, { recursive: true })
  try {
    registerProject(first, { dir, select: false })
    registerProject(second, { dir, select: false })
    const state = readRegisteredProjects(dir)
    assert.deepEqual(
      state.projects.map((project) => project.label),
      ['One/App', 'Two/App'],
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('selecting a registered project updates the live target', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbase-projects-'))
  const first = path.join(dir, 'apps/alpha')
  const second = path.join(dir, 'apps/beta')
  fs.mkdirSync(first, { recursive: true })
  fs.mkdirSync(second, { recursive: true })
  const previous = targetRoot
  try {
    registerProject(first, { dir, select: true })
    registerProject(second, { dir, select: true })
    assert.equal(targetRoot, path.resolve(second))
    selectProject(path.resolve(first), { dir })
    assert.equal(targetRoot, path.resolve(first))
    assert.equal(projectsState({ dir }).currentId, path.resolve(first))
  } finally {
    applyTargetRoot(previous)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
