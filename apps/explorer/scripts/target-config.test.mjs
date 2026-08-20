import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { resolveDataDir, resolveTargetPathPrefix, resolveTargetRoot } from './target-config.mjs'

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

test('defaults data dir to explorer src/data', () => {
  assert.equal(resolveDataDir(''), defaultDataDir)
  assert.equal(resolveDataDir(undefined), defaultDataDir)
})

test('resolves absolute and cwd-relative data dirs', () => {
  assert.equal(resolveDataDir('/tmp/inbase-data'), path.normalize('/tmp/inbase-data'))
  assert.equal(resolveDataDir('.inbase'), path.resolve(process.cwd(), '.inbase'))
})
