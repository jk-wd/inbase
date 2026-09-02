import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  CONFIG_FILE_NAME,
  findInbaseConfigFile,
  loadInbaseConfig,
  parseInbaseConfig,
  resolveConfigPath,
  resolvePort,
  writeInbaseConfig,
} from './inbase-config.mjs'
import { applyHostEnv } from './project.mjs'
import { resolveDefaultStepByStep } from '../apps/explorer/scripts/session-store.mjs'
import { scanTarget } from '../apps/explorer/scripts/scan-target.mjs'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function tempGitProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbase-config-'))
  fs.mkdirSync(path.join(root, '.git'))
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}

function snapshotEnv(...keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]))
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function writeConfig(root, value) {
  fs.writeFileSync(path.join(root, CONFIG_FILE_NAME), `${JSON.stringify(value, null, 2)}\n`)
}

function scanQuiet(options) {
  const log = console.log
  console.log = () => {}
  try {
    return scanTarget(options)
  } finally {
    console.log = log
  }
}

test('finds inbase.json at the git root when started from a nested folder', () => {
  const { root, cleanup } = tempGitProject()
  try {
    const nested = path.join(root, 'apps/web')
    fs.mkdirSync(nested, { recursive: true })
    writeConfig(root, { target: 'apps/web' })
    assert.equal(findInbaseConfigFile(nested), path.join(root, CONFIG_FILE_NAME))
  } finally {
    cleanup()
  }
})

test('does not walk out of a nested git checkout', () => {
  const { root, cleanup } = tempGitProject()
  try {
    writeConfig(root, { target: 'outer' })
    const inner = path.join(root, 'vendor/other')
    fs.mkdirSync(path.join(inner, '.git'), { recursive: true })
    assert.equal(findInbaseConfigFile(inner), null)
  } finally {
    cleanup()
  }
})

test('resolves target paths against the config file directory', () => {
  const { root, cleanup } = tempGitProject()
  try {
    writeConfig(root, { target: 'apps/web' })
    const config = loadInbaseConfig(root)
    assert.equal(config.target, 'apps/web')
    assert.equal(resolveConfigPath(config.target, config.dir), path.join(root, 'apps/web'))
  } finally {
    cleanup()
  }
})

test('applyHostEnv uses inbase.json target and keeps data dir at the kickoff root', () => {
  const { root, cleanup } = tempGitProject()
  const env = snapshotEnv('VISUAL_CODER_TARGET', 'INBASE_DATA_DIR', 'INBASE_CONFIG')
  try {
    delete process.env.VISUAL_CODER_TARGET
    delete process.env.INBASE_DATA_DIR
    delete process.env.INBASE_CONFIG
    const target = path.join(root, 'apps/web')
    fs.mkdirSync(target, { recursive: true })
    writeConfig(root, { target: 'apps/web', port: 5188 })
    const host = applyHostEnv({ cwd: root })
    assert.equal(host.targetRoot, path.resolve(target))
    assert.equal(host.dataDir, path.join(root, '.inbase'))
    assert.equal(host.config.port, 5188)
    assert.equal(process.env.INBASE_CONFIG, path.join(root, CONFIG_FILE_NAME))
  } finally {
    restoreEnv(env)
    cleanup()
  }
})

test('CLI and env target win over inbase.json', () => {
  const { root, cleanup } = tempGitProject()
  const env = snapshotEnv('VISUAL_CODER_TARGET', 'INBASE_DATA_DIR', 'INBASE_CONFIG')
  try {
    delete process.env.INBASE_DATA_DIR
    delete process.env.INBASE_CONFIG
    writeConfig(root, { target: 'apps/web' })
    const flagged = path.join(root, 'from-flag')
    fs.mkdirSync(flagged, { recursive: true })
    const host = applyHostEnv({ cwd: root, target: flagged })
    assert.equal(host.targetRoot, path.resolve(flagged))
    assert.equal(host.dataDir, path.join(flagged, '.inbase'))
  } finally {
    restoreEnv(env)
    cleanup()
  }
})

test('resolvePort prefers the CLI flag over inbase.json', () => {
  assert.equal(resolvePort('5199', { port: 5188 }), 5199)
  assert.equal(resolvePort(null, { port: 5188 }), 5188)
  assert.equal(resolvePort(undefined, { port: null }), 5173)
  assert.throws(() => resolvePort('nope', { port: 5188 }), /must be an integer/)
})

test('writeInbaseConfig is a no-op when the file already exists', () => {
  const { root, cleanup } = tempGitProject()
  try {
    writeConfig(root, { target: 'keep-me' })
    assert.equal(writeInbaseConfig(root), false)
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, CONFIG_FILE_NAME), 'utf8')).target, 'keep-me')
    const other = path.join(root, 'empty')
    fs.mkdirSync(other)
    assert.equal(writeInbaseConfig(other), true)
    assert.equal(JSON.parse(fs.readFileSync(path.join(other, CONFIG_FILE_NAME), 'utf8')).target, '.')
  } finally {
    cleanup()
  }
})

test('rejects invalid settings', () => {
  assert.throws(() => parseInbaseConfig('{'), /not valid JSON/)
  assert.throws(() => parseInbaseConfig(JSON.stringify({ target: '' })), /non-empty string/)
  assert.throws(() => parseInbaseConfig(JSON.stringify({ port: 51.5 })), /integer/)
  assert.throws(() => parseInbaseConfig(JSON.stringify({ ignore: 'vendor' })), /array of strings/)
  assert.throws(() => parseInbaseConfig(JSON.stringify({ stepByStep: 'yes' })), /boolean/)
})

test('scanTarget honours extra ignore patterns', () => {
  const { root, cleanup } = tempGitProject()
  const env = snapshotEnv('INBASE_CONFIG')
  try {
    delete process.env.INBASE_CONFIG
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.mkdirSync(path.join(root, 'vendor/lib'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src/app.ts'), 'export const app = 1\n')
    fs.writeFileSync(path.join(root, 'src/skip.generated.ts'), 'export const skip = 1\n')
    fs.writeFileSync(path.join(root, 'vendor/lib/index.ts'), 'export const vendored = 1\n')
    const graph = scanQuiet({
      root,
      dest: path.join(root, 'codebase.json'),
      ignore: ['vendor', '*.generated.ts'],
    })
    assert.deepEqual(
      graph.files.map((file) => file.id).sort(),
      ['src/app.ts'],
    )
  } finally {
    restoreEnv(env)
    cleanup()
  }
})

test('resolveDefaultStepByStep reads inbase.json', () => {
  const { root, cleanup } = tempGitProject()
  const env = snapshotEnv('INBASE_CONFIG')
  try {
    writeConfig(root, { stepByStep: true })
    process.env.INBASE_CONFIG = path.join(root, CONFIG_FILE_NAME)
    assert.equal(resolveDefaultStepByStep(), true)
    writeConfig(root, { stepByStep: false })
    assert.equal(resolveDefaultStepByStep(), false)
  } finally {
    restoreEnv(env)
    cleanup()
  }
})

test('this repository maps apps/example-target from inbase.json', () => {
  const config = loadInbaseConfig(packageRoot)
  assert.equal(config.target, 'apps/example-target')
  assert.equal(
    resolveConfigPath(config.target, config.dir),
    path.join(packageRoot, 'apps/example-target'),
  )
})
