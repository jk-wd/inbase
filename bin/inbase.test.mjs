import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { initProject, isCliEntry, main } from './inbase.mjs'
import { applyHostEnv, copyDir, ensureDataDir, ensureGitignoreEntry, skillTemplateDir } from './project.mjs'

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

test('copyDir installs the skill template', () => {
  const { root, cleanup } = tempProject()
  try {
    const dest = path.join(root, 'skills/inbase')
    copyDir(skillTemplateDir, dest)
    assert.match(
      fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8'),
      /npx inbase start-session/,
    )
  } finally {
    cleanup()
  }
})

test('init copies the Cursor skill and gitignores .inbase', () => {
  const { root, cleanup } = tempProject()
  const env = snapshotEnv('VISUAL_CODER_TARGET', 'INBASE_DATA_DIR')
  try {
    const result = initProject(root)
    const skill = path.join(root, '.cursor/skills/inbase/SKILL.md')
    assert.equal(result.skillDir, path.join(root, '.cursor/skills/inbase'))
    assert.equal(fs.existsSync(skill), true)
    assert.match(fs.readFileSync(skill, 'utf8'), /npx inbase start-session/)
    assert.equal(fs.existsSync(path.join(root, '.inbase/user-context.json')), true)
    assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /\.inbase\//)
  } finally {
    restoreEnv(env)
    cleanup()
  }
})

test('gitignore helper is idempotent', () => {
  const { root, cleanup } = tempProject()
  try {
    assert.equal(ensureGitignoreEntry(root), true)
    assert.equal(ensureGitignoreEntry(root), false)
    const text = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
    assert.equal(text.split('.inbase/').length - 1, 1)
  } finally {
    cleanup()
  }
})

test('help prints usage', async () => {
  let output = ''
  const log = console.log
  console.log = (message) => {
    output += String(message)
  }
  try {
    await main(['help'])
    assert.match(output, /inbase init/)
    assert.match(output, /inbase run/)
  } finally {
    console.log = log
  }
})

test('start-session writes a manifest under .inbase', async () => {
  const { root, cleanup } = tempProject()
  const env = snapshotEnv('VISUAL_CODER_TARGET', 'INBASE_DATA_DIR')
  let output = ''
  const log = console.log
  try {
    applyHostEnv({ cwd: root, target: root, dataDir: path.join(root, '.inbase') })
    ensureDataDir(process.env.INBASE_DATA_DIR)
    console.log = (message) => {
      output += String(message)
    }
    await main(['start-session', '--session', 'cli-test-session'])
    const manifest = path.join(root, '.inbase/diff-sessions/cli-test-session/manifest.json')
    assert.equal(fs.existsSync(manifest), true)
    assert.match(output, /VISUAL_CODER_BLUEPRINT_WAIT/)
  } finally {
    console.log = log
    restoreEnv(env)
    cleanup()
  }
})

test('CLI entry detection follows npm bin symlinks', () => {
  const { root, cleanup } = tempProject()
  try {
    const bin = path.join(packageRoot, 'bin/inbase.mjs')
    const shim = path.join(root, 'inbase')
    fs.symlinkSync(bin, shim)
    assert.equal(isCliEntry(shim), true)
    assert.equal(isCliEntry(bin), true)
    assert.equal(isCliEntry(fileURLToPath(import.meta.url)), false)
  } finally {
    cleanup()
  }
})
