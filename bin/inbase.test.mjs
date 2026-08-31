import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { initProject, isCliEntry, main } from './inbase.mjs'
import {
  applyHostEnv,
  copyDir,
  ensureDataDir,
  ensureGitignoreEntry,
  skillTemplateDir,
  writeRunningInstance,
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

test('copyDir installs the skill template', () => {
  const { root, cleanup } = tempProject()
  try {
    const dest = path.join(root, 'skills/inbase')
    copyDir(skillTemplateDir, dest)
    const skillText = fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8')
    assert.match(skillText, /npx inbase attach/)
    assert.match(skillText, /VISUAL_CODER_ACK/)
    assert.match(skillText, /Direct response/)
    assert.match(skillText, /VISUAL_CODER_NOT_RUNNING/)
    assert.match(skillText, /VISUAL_CODER_CHAT_LIMIT/)
    assert.match(skillText, /VISUAL_CODER_COLOR/)
    assert.match(skillText, /Connecting to the Coral session/)
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
    const skillText = fs.readFileSync(skill, 'utf8')
    assert.match(skillText, /npx inbase attach/)
    assert.match(skillText, /VISUAL_CODER_ACK/)
    assert.match(skillText, /VISUAL_CODER_NOT_RUNNING/)
    assert.match(skillText, /VISUAL_CODER_CHAT_LIMIT/)
    assert.match(skillText, /VISUAL_CODER_COLOR/)
    assert.match(skillText, /\/go/)
    assert.match(skillText, /\/accept/)
    assert.match(skillText, /\/explain/)
    assert.doesNotMatch(skillText, /npx inbase wait-for-approval/)
    assert.doesNotMatch(skillText, /npx inbase explain wait/)
    assert.doesNotMatch(skillText, /direct chat interaction not allowed/)
    assert.doesNotMatch(skillText, /npx inbase start-session/)
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/inbase.md')), true)
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/inbase.md'), 'utf8'),
      /npx inbase attach/,
    )
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/skipinbase.md')), true)
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/skipinbase.md'), 'utf8'),
      /\$ARGUMENTS/,
    )
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/explain.md')), true)
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/explain.md'), 'utf8'),
      /npx inbase explain start/,
    )
    assert.doesNotMatch(
      fs.readFileSync(path.join(root, '.cursor/commands/explain.md'), 'utf8'),
      /npx inbase explain wait/,
    )
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/explain.md'), 'utf8'),
      /VISUAL_CODER_PROPOSAL/,
    )
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/go.md')), true)
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/go.md'), 'utf8'),
      /npx inbase go/,
    )
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/accept.md')), true)
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/accept.md'), 'utf8'),
      /npx inbase accept/,
    )
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/coral.md')), true)
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/coral.md'), 'utf8'),
      /npx inbase attach --color coral/,
    )
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/red.md')), true)
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/red.md'), 'utf8'),
      /npx inbase attach --color red/,
    )
    assert.equal(fs.existsSync(path.join(root, '.cursor/commands/blue.md')), true)
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/blue.md'), 'utf8'),
      /global blueprint/,
    )
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
    assert.match(output, /inbase attach \[--session <id>\] \[--color <name>\]/)
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
    await main([
      'start-session',
      '--session',
      'cli-test-session',
      '--name',
      'CLI test session',
    ])
    const manifest = path.join(root, '.inbase/diff-sessions/cli-test-session/manifest.json')
    assert.equal(fs.existsSync(manifest), true)
    const stored = JSON.parse(fs.readFileSync(manifest, 'utf8'))
    assert.equal(stored.name, 'CLI test session')
    assert.match(output, /VISUAL_CODER_BLUEPRINT_WAIT/)
    assert.match(output, /CLI test session/)
  } finally {
    console.log = log
    restoreEnv(env)
    cleanup()
  }
})

function runCli(args, { cwd, env } = {}) {
  return spawnSync(process.execPath, [path.join(packageRoot, 'bin/inbase.mjs'), ...args], {
    cwd: cwd ?? packageRoot,
    encoding: 'utf8',
    env,
  })
}

test('wait-for-approval and explain wait are removed', () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    writeRunningInstance({ dataDir, targetRoot: root })
    const approval = runCli(['wait-for-approval', '--session', 'gone'], {
      cwd: root,
      env,
    })
    assert.notEqual(approval.status, 0)
    assert.match(approval.stderr, /wait-for-approval was removed/)
    const waiting = runCli(['explain', 'wait'], { cwd: root, env })
    assert.notEqual(waiting.status, 0)
    assert.match(waiting.stderr, /explain wait was removed/)
  } finally {
    cleanup()
  }
})

test('wait-for-blueprint does not consume a pending map explain', async () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const started = runCli(
      ['start-session', '--session', 'explain-pending', '--name', 'Explain pending'],
      { cwd: root, env },
    )
    assert.equal(started.status, 0, started.stderr)
    const explain = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/explain-store.mjs')).href
    )
    explain.requestExplainTarget(dataDir, {
      kind: 'folder',
      path: 'apps/explorer/scripts',
    })
    const result = runCli(
      ['wait-for-blueprint', '--session', 'explain-pending'],
      { cwd: root, env },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK blueprint/)
    assert.doesNotMatch(result.stdout, /VISUAL_CODER_EXPLAIN The user clicked/)
    assert.equal(explain.readExplain(dataDir).pendingStart.path, 'apps/explorer/scripts')
  } finally {
    cleanup()
  }
})

test('explain start uses a pending map question mark', async () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const explain = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/explain-store.mjs')).href
    )
    fs.mkdirSync(dataDir, { recursive: true })
    writeRunningInstance({ dataDir, targetRoot: root })
    explain.requestExplainTarget(dataDir, {
      kind: 'folder',
      path: 'apps/explorer/src',
    })
    const result = runCli(['explain', 'start'], { cwd: root, env })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK explain: folder apps\/explorer\/src/)
    assert.match(result.stdout, /VISUAL_CODER_EXPLAIN_STARTED/)
    assert.equal(explain.readExplain(dataDir).pendingStart, null)
  } finally {
    cleanup()
  }
})

test('explain start with a question reports a follow-up when explain is active', async () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const explain = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/explain-store.mjs')).href
    )
    fs.mkdirSync(dataDir, { recursive: true })
    writeRunningInstance({ dataDir, targetRoot: root })
    explain.startExplain(dataDir, 'How does World work?')
    explain.reportExplain(dataDir, {
      question: 'How does World work?',
      steps: [{ title: 'World layout' }, { title: 'Folder floors' }],
    })
    const result = runCli(
      ['explain', 'start', '--question', 'Why is World selected?'],
      { cwd: root, env },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK question/)
    assert.match(result.stdout, /VISUAL_CODER_EXPLAIN_FOLLOWUP/)
    assert.match(result.stdout, /VISUAL_CODER_PARENT 1/)
    assert.match(result.stdout, /Why is World selected\?/)
  } finally {
    cleanup()
  }
})

function planSession(store, dataDir, target, sessionId, name, stepTitles) {
  const started = runCli(
    ['start-session', '--session', sessionId, '--name', name],
    {
      cwd: path.dirname(dataDir),
      env: {
        ...process.env,
        VISUAL_CODER_TARGET: target,
        INBASE_DATA_DIR: dataDir,
      },
    },
  )
  assert.equal(started.status, 0, started.stderr)
  store.answerBlueprint(dataDir, sessionId, false)
  store.reportPlan(dataDir, {
    sessionId,
    feature: name,
    stepTitles,
    targetRoot: target,
  })
}

test('go invokes the waiting plan step', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    planSession(store, dataDir, target, 'continue-chat', 'Continue chat', [
      'Bump value',
      'Bump again',
    ])
    writeRunningInstance({ dataDir, targetRoot: target })
    const result = runCli(['go', '--session', 'continue-chat'], {
      cwd: root,
      env,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK execute: step 1 — Bump value/)
    assert.match(result.stdout, /VISUAL_CODER_EXECUTE Step 1 is invoked: Bump value/)
    assert.equal(store.readManifest(dataDir, 'continue-chat').phase, 'working')
  } finally {
    cleanup()
  }
})

test('go refuses a waiting proposal', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    planSession(store, dataDir, target, 'continue-review', 'Continue review', [
      'Bump value',
    ])
    store.invokeStep(dataDir, 'continue-review', 1, target)
    store.appendDiff(dataDir, target, {
      sessionId: 'continue-review',
      patchText:
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 2\n',
    })
    writeRunningInstance({ dataDir, targetRoot: target })
    const result = runCli(['go', '--session', 'continue-review'], {
      cwd: root,
      env,
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Use \/accept/)
  } finally {
    cleanup()
  }
})

test('accept waits for go on the next step', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    planSession(store, dataDir, target, 'accept-next', 'Accept next', [
      'Bump value',
      'Bump again',
    ])
    store.invokeStep(dataDir, 'accept-next', 1, target)
    store.appendDiff(dataDir, target, {
      sessionId: 'accept-next',
      patchText:
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 2\n',
    })
    writeRunningInstance({ dataDir, targetRoot: target })
    const result = runCli(['accept', '--session', 'accept-next'], {
      cwd: root,
      env,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK plan: waiting for \/go on step 2 — Bump again/)
    assert.match(result.stdout, /VISUAL_CODER_ACCEPTED Accepted the proposal/)
    assert.match(result.stdout, /Wait for the user to type \/go step 2: Bump again/)
    assert.equal(store.readManifest(dataDir, 'accept-next').phase, 'plan_ready')
    assert.equal(store.readManifest(dataDir, 'accept-next').currentStep, 2)
  } finally {
    cleanup()
  }
})

test('accept finishes the last step', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    planSession(store, dataDir, target, 'accept-last', 'Accept last', [
      'Bump value',
    ])
    store.invokeStep(dataDir, 'accept-last', 1, target)
    store.appendDiff(dataDir, target, {
      sessionId: 'accept-last',
      patchText:
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 2\n',
    })
    writeRunningInstance({ dataDir, targetRoot: target })
    const result = runCli(['accept', '--session', 'accept-last'], {
      cwd: root,
      env,
    })
    assert.equal(result.status, 5, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_FINISHED/)
    assert.equal(store.readManifest(dataDir, 'accept-last'), null)
  } finally {
    cleanup()
  }
})

test('explain start detects a waiting proposal', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    planSession(store, dataDir, target, 'explain-proposal', 'Explain proposal', [
      'Bump value',
    ])
    writeRunningInstance({ dataDir, targetRoot: target })
    const withQuestion = runCli(
      ['explain', 'start', '--question', 'why this import'],
      { cwd: root, env },
    )
    assert.equal(withQuestion.status, 0, withQuestion.stderr)
    assert.match(withQuestion.stdout, /VISUAL_CODER_PROPOSAL/)
    assert.match(withQuestion.stdout, /Bump value/)
    assert.match(withQuestion.stdout, /why this import/)
    runCli(['explain', 'stop'], { cwd: root, env })

    const withoutQuestion = runCli(['explain', 'start'], { cwd: root, env })
    assert.equal(withoutQuestion.status, 0, withoutQuestion.stderr)
    assert.match(withoutQuestion.stdout, /VISUAL_CODER_PROPOSAL/)
    assert.match(
      withoutQuestion.stdout,
      /VISUAL_CODER_EXPLAIN_STARTED Explain the current proposal: Bump value/,
    )
  } finally {
    cleanup()
  }
})
