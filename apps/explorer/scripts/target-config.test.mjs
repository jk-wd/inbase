import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { resolveTargetPathPrefix, resolveTargetRoot } from './target-config.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const explorerRoot = path.resolve(here, '..')
const defaultTarget = path.resolve(explorerRoot, '../example-target')
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
