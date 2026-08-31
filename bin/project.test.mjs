import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  applyHostEnv,
  isolatedViteConfig,
  packageDirFromPackage,
  readInstanceFile,
  readRunningInstance,
  resolveFromPackage,
  writeRunningInstance,
  isPidAlive,
} from './project.mjs'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function tempProject() {
  const root = fs.mkdtempSync(path.join(packageRoot, '.tmp-cli-'))
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

test('writeRunningInstance records a live visualizer', () => {
  const { root, cleanup } = tempProject()
  try {
    const dataDir = path.join(root, '.inbase')
    const targetRoot = path.join(root, 'app')
    const instance = writeRunningInstance({ dataDir, targetRoot, port: 5173 })
    assert.equal(instance.pid, process.pid)
    assert.equal(instance.port, 5173)
    const read = readInstanceFile(path.join(dataDir, 'instance.json'))
    assert.equal(read.dataDir, path.resolve(dataDir))
    assert.equal(read.targetRoot, path.resolve(targetRoot))
  } finally {
    cleanup()
  }
})

test('readInstanceFile ignores a dead visualizer pid', () => {
  const { root, cleanup } = tempProject()
  try {
    const file = path.join(root, 'instance.json')
    fs.writeFileSync(
      file,
      `${JSON.stringify({
        dataDir: path.join(root, 'data'),
        targetRoot: path.join(root, 'app'),
        pid: 2147483647,
      })}\n`,
    )
    assert.equal(readInstanceFile(file), null)
  } finally {
    cleanup()
  }
})

test('readInstanceFile treats EPERM as a live visualizer', () => {
  const { root, cleanup } = tempProject()
  const originalKill = process.kill
  process.kill = (pid, signal) => {
    if (pid === 12345) {
      const error = new Error('kill EPERM')
      error.code = 'EPERM'
      throw error
    }
    return originalKill.call(process, pid, signal)
  }
  try {
    const file = path.join(root, 'instance.json')
    fs.writeFileSync(
      file,
      `${JSON.stringify({
        dataDir: path.join(root, 'data'),
        targetRoot: path.join(root, 'app'),
        pid: 12345,
      })}\n`,
    )
    const read = readInstanceFile(file)
    assert.equal(read.pid, 12345)
    assert.equal(isPidAlive(12345), true)
    assert.equal(isPidAlive(2147483647), false)
  } finally {
    process.kill = originalKill
    cleanup()
  }
})

test('applyHostEnv attaches to a running instance when env is unset', () => {
  const { root, cleanup } = tempProject()
  const env = snapshotEnv('VISUAL_CODER_TARGET', 'INBASE_DATA_DIR')
  try {
    delete process.env.VISUAL_CODER_TARGET
    delete process.env.INBASE_DATA_DIR
    const dataDir = path.join(root, '.inbase')
    const targetRoot = path.join(root, 'app')
    writeRunningInstance({ dataDir, targetRoot, port: 5188 })
    const host = applyHostEnv({ cwd: root })
    assert.equal(host.dataDir, path.resolve(dataDir))
    assert.equal(host.targetRoot, path.resolve(targetRoot))
    assert.equal(host.instance.port, 5188)
  } finally {
    restoreEnv(env)
    cleanup()
  }
})

test('applyHostEnv keeps explicit target and data dir over a running instance', () => {
  const { root, cleanup } = tempProject()
  const env = snapshotEnv('VISUAL_CODER_TARGET', 'INBASE_DATA_DIR')
  try {
    writeRunningInstance({
      dataDir: path.join(root, 'viz-data'),
      targetRoot: path.join(root, 'viz-app'),
    })
    const target = path.join(root, 'other-app')
    const dataDir = path.join(root, 'other-data')
    const host = applyHostEnv({ cwd: root, target, dataDir })
    assert.equal(host.targetRoot, path.resolve(target))
    assert.equal(host.dataDir, path.resolve(dataDir))
    assert.equal(host.instance, null)
  } finally {
    restoreEnv(env)
    cleanup()
  }
})

test('readRunningInstance prefers cwd .inbase over a missing file', () => {
  const { root, cleanup } = tempProject()
  try {
    const dataDir = path.join(root, '.inbase')
    const targetRoot = path.join(root, 'app')
    writeRunningInstance({ dataDir, targetRoot })
    const instance = readRunningInstance(root)
    assert.equal(instance.dataDir, path.resolve(dataDir))
    assert.equal(instance.targetRoot, path.resolve(targetRoot))
  } finally {
    cleanup()
  }
})

test('isolated Vite config does not use the host project', () => {
  const dataDir = path.join(packageRoot, '.tmp-cli-vite-data')
  const config = isolatedViteConfig(dataDir)
  assert.equal(config.root, path.join(packageRoot, 'apps/explorer'))
  assert.equal(config.envDir, config.root)
  assert.equal(config.cacheDir, path.join(dataDir, 'vite'))
  assert.equal(config.build.target, 'esnext')
  assert.equal(config.esbuild.target, 'esnext')
  assert.deepEqual(config.server.fs.allow, [config.root, packageRoot, dataDir])
  assert.equal(
    config.optimizeDeps.entries[0],
    path.join(packageRoot, 'apps/explorer/index.html'),
  )
  const vitePath = resolveFromPackage('vite')
  assert.match(vitePath, /node_modules[/\\]vite/)
  assert.ok(
    vitePath.startsWith(packageRoot + path.sep) ||
      vitePath.includes(`${path.sep}node_modules${path.sep}vite`),
  )
  const threeDir = packageDirFromPackage('three')
  assert.equal(fs.existsSync(path.join(threeDir, 'package.json')), true)
  assert.doesNotMatch(threeDir, /\/package\.json$/)
})
