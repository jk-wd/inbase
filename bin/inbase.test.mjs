import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
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
import { createManifestGate } from './session.mjs'

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
    assert.match(
      fs.readFileSync(path.join(root, '.cursor/commands/explain.md'), 'utf8'),
      /npx inbase explain wait/,
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

function collectChild(child) {
  const result = { stdout: '', stderr: '' }
  let resolveReady
  const ready = new Promise((resolve) => {
    resolveReady = resolve
  })
  child.stdout.on('data', (chunk) => {
    result.stdout += chunk
    if (resolveReady) {
      resolveReady()
      resolveReady = null
    }
  })
  child.stderr.on('data', (chunk) => {
    result.stderr += chunk
  })
  const closed = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, ...result }))
  })
  return { ready, closed }
}

test('start-session requires a generated session name', () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const result = runCli(['start-session', '--session', 'no-name'], {
      cwd: root,
      env,
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /--name "short name"/)
  } finally {
    cleanup()
  }
})

test('start-session still waits for blueprint on an existing session', async () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const first = runCli(
      ['start-session', '--session', 'resume-chat', '--name', 'Resume chat'],
      { cwd: root, env },
    )
    assert.equal(first.status, 0, first.stderr)
    assert.match(first.stdout, /VISUAL_CODER_BLUEPRINT_WAIT/)
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    store.answerBlueprint(dataDir, 'resume-chat', false)
    const second = runCli(
      ['start-session', '--session', 'resume-chat', '--name', 'Resume chat'],
      { cwd: root, env },
    )
    assert.equal(second.status, 0, second.stderr)
    assert.match(second.stdout, /VISUAL_CODER_BLUEPRINT_WAIT/)
    assert.doesNotMatch(second.stdout, /VISUAL_CODER_PREPARING/)
  } finally {
    cleanup()
  }
})

test('start-session attaches to a running visualizer instance', () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  try {
    fs.mkdirSync(target)
    writeRunningInstance({ dataDir, targetRoot: target })
    ensureDataDir(dataDir)
    const env = { ...process.env }
    delete env.VISUAL_CODER_TARGET
    delete env.INBASE_DATA_DIR
    const result = runCli(
      ['start-session', '--session', 'attach-chat', '--name', 'Attach chat'],
      {
        cwd: root,
        env,
      },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /INBASE_ATTACHED/)
    assert.match(result.stdout, /VISUAL_CODER_BLUEPRINT_WAIT/)
    assert.equal(
      fs.existsSync(path.join(dataDir, 'diff-sessions/attach-chat/manifest.json')),
      true,
    )
  } finally {
    cleanup()
  }
})

test('attach without --session uses the oldest waiting visualizer session', async () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    fs.mkdirSync(dataDir, { recursive: true })
    writeRunningInstance({ dataDir, targetRoot: root })
    const older = store.setupSession(dataDir)
    const started = store.setupSession(dataDir)
    store.focusSession(dataDir, started.sessionId)
    const missing = runCli(['attach'], { cwd: root, env })
    assert.equal(missing.status, 0, missing.stderr)
    assert.match(missing.stdout, /VISUAL_CODER_ATTACHED/)
    assert.match(missing.stdout, /VISUAL_CODER_COLOR /)
    assert.match(missing.stdout, /VISUAL_CODER_ACK attached:/)
    assert.match(missing.stdout, new RegExp(`VISUAL_CODER_SESSION ${older.sessionId}`))
    assert.equal(store.readManifest(dataDir, older.sessionId).awaitingAttach, false)
    assert.equal(store.readManifest(dataDir, started.sessionId).awaitingAttach, true)
  } finally {
    cleanup()
  }
})

test('attach --color uses that waiting session even if it is not first', async () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    fs.mkdirSync(dataDir, { recursive: true })
    writeRunningInstance({ dataDir, targetRoot: root })
    const coral = store.setupSession(dataDir)
    const amber = store.setupSession(dataDir)
    store.focusSession(dataDir, amber.sessionId)
    const result = runCli(['attach', '--color', 'yellow'], { cwd: root, env })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ATTACHED/)
    assert.match(result.stdout, /VISUAL_CODER_COLOR Amber/)
    assert.match(result.stdout, new RegExp(`VISUAL_CODER_SESSION ${amber.sessionId}`))
    assert.equal(store.readManifest(dataDir, coral.sessionId).awaitingAttach, true)
    assert.equal(store.readManifest(dataDir, amber.sessionId).awaitingAttach, false)
  } finally {
    cleanup()
  }
})

test('attach --color red maps to Coral and busy/unknown colors fail', async () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    fs.mkdirSync(dataDir, { recursive: true })
    writeRunningInstance({ dataDir, targetRoot: root })
    const coral = store.setupSession(dataDir)
    store.setupSession(dataDir)
    const first = runCli(['attach', '--color', 'red'], { cwd: root, env })
    assert.equal(first.status, 0, first.stderr)
    assert.match(first.stdout, /VISUAL_CODER_COLOR Coral/)
    assert.match(first.stdout, new RegExp(`VISUAL_CODER_SESSION ${coral.sessionId}`))
    const busy = runCli(['attach', '--color', 'coral'], { cwd: root, env })
    assert.notEqual(busy.status, 0)
    assert.match(busy.stderr, /VISUAL_CODER_COLOR_BUSY/)
    const unknown = runCli(['attach', '--color', 'blue'], { cwd: root, env })
    assert.notEqual(unknown.status, 0)
    assert.match(unknown.stderr, /VISUAL_CODER_COLOR_UNKNOWN/)
  } finally {
    cleanup()
  }
})

test('explain without a running visualizer tells the chat to start Inbase', () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    const result = runCli(['explain', 'start', '--question', 'How does World work?'], {
      cwd: root,
      env,
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /VISUAL_CODER_NOT_RUNNING/)
  } finally {
    cleanup()
  }
})

test('explain start and report write explain.json for the running visualizer', async () => {
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
    const started = runCli(
      ['explain', 'start', '--question', 'How does World work?'],
      { cwd: root, env },
    )
    assert.equal(started.status, 0, started.stderr)
    assert.match(started.stdout, /VISUAL_CODER_EXPLAIN_STARTED/)
    assert.equal(explain.readExplain(dataDir).active, true)

    const reported = runCli(
      [
        'explain',
        'report',
        '--question',
        'How does World work?',
        '--step',
        'World layout',
        '--body',
        'World places folders and files.',
        '--files',
        'apps/explorer/src/scene/World.tsx',
        '--select',
        'apps/explorer/src/scene/World.tsx',
        '--zoom',
        'apps/explorer/src/scene',
      ],
      { cwd: root, env },
    )
    assert.equal(reported.status, 0, reported.stderr)
    assert.match(reported.stdout, /VISUAL_CODER_EXPLAIN_READY/)
    const next = explain.readExplain(dataDir)
    assert.equal(next.steps.length, 1)
    assert.equal(next.steps[0].title, 'World layout')
    assert.equal(next.steps[0].select, 'apps/explorer/src/scene/World.tsx')
    assert.equal(next.steps[0].index, '1')

    const followUp = runCli(
      [
        'explain',
        'report',
        '--parent',
        '1',
        '--question',
        'Where is the camera?',
        '--step',
        'MapView flies focus',
        '--body',
        'Explain mode changes focusFlightKey so MapView animates.',
        '--files',
        'apps/explorer/src/scene/MapView.tsx',
      ],
      { cwd: root, env },
    )
    assert.equal(followUp.status, 0, followUp.stderr)
    assert.match(followUp.stdout, /VISUAL_CODER_EXPLAIN_READY/)
    const nested = explain.readExplain(dataDir)
    assert.deepEqual(
      nested.steps.map((step) => step.index),
      ['1', '1.1'],
    )
    assert.equal(nested.currentStep, '1.1')
    assert.equal(nested.steps[0].asked, 'Where is the camera?')

    const stopped = runCli(['explain', 'stop'], { cwd: root, env })
    assert.equal(stopped.status, 0, stopped.stderr)
    assert.equal(explain.readExplain(dataDir).active, false)
  } finally {
    cleanup()
  }
})

test('explain wait returns when the user asks about a step', async () => {
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

    const child = spawn(
      process.execPath,
      [path.join(packageRoot, 'bin/inbase.mjs'), 'explain', 'wait', '--timeout', '5000'],
      { cwd: root, env, encoding: 'utf8' },
    )
    const pending = collectChild(child)
    await Promise.race([
      pending.ready,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('explain wait never started')), 4000)
      }),
    ])
    explain.askExplainQuestion(dataDir, '1', 'Why is World selected?')
    const result = await pending.closed
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK question: step 1/)
    assert.match(result.stdout, /VISUAL_CODER_EXPLAIN_QUESTION/)
    assert.match(result.stdout, /VISUAL_CODER_PARENT 1/)
    assert.match(result.stdout, /Why is World selected\?/)
    assert.equal(explain.readExplain(dataDir).answering, true)
    assert.equal(explain.readExplain(dataDir).pendingQuestion.parent, '1')
  } finally {
    cleanup()
  }
})

test('explain wait returns when the user clicks Explain on a file', async () => {
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

    const child = spawn(
      process.execPath,
      [path.join(packageRoot, 'bin/inbase.mjs'), 'explain', 'wait', '--timeout', '5000'],
      { cwd: root, env, encoding: 'utf8' },
    )
    const pending = collectChild(child)
    await Promise.race([
      pending.ready,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('explain wait never started')), 4000)
      }),
    ])
    explain.requestExplainTarget(dataDir, {
      kind: 'file',
      path: 'apps/explorer/src/App.tsx',
    })
    const result = await pending.closed
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK explain: file apps\/explorer\/src\/App\.tsx/)
    assert.match(result.stdout, /VISUAL_CODER_EXPLAIN/)
    assert.match(result.stdout, /Replace the current explanation/)
    assert.match(
      result.stdout,
      /Explain the function of the file apps\/explorer\/src\/App\.tsx/,
    )
    assert.equal(explain.readExplain(dataDir).pendingStart, null)
    assert.equal(explain.readExplain(dataDir).active, true)
  } finally {
    cleanup()
  }
})

test('attach without a running visualizer tells the chat to start Inbase', () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    const result = runCli(['attach'], { cwd: root, env })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /VISUAL_CODER_NOT_RUNNING/)
    assert.match(result.stderr, /npx inbase run/)
  } finally {
    cleanup()
  }
})

test('attach without a waiting session fails', () => {
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
    const result = runCli(['attach'], { cwd: root, env })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /VISUAL_CODER_CHAT_LIMIT/)
  } finally {
    cleanup()
  }
})

test('attach skips an already attached session and takes the next in queue', async () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    fs.mkdirSync(dataDir, { recursive: true })
    writeRunningInstance({ dataDir, targetRoot: root })
    const first = store.setupSession(dataDir)
    const second = store.setupSession(dataDir)
    const attached = runCli(['attach'], { cwd: root, env })
    assert.equal(attached.status, 0, attached.stderr)
    assert.match(attached.stdout, new RegExp(`VISUAL_CODER_SESSION ${first.sessionId}`))
    store.focusSession(dataDir, first.sessionId)
    const next = runCli(['attach'], { cwd: root, env })
    assert.equal(next.status, 0, next.stderr)
    assert.match(next.stdout, new RegExp(`VISUAL_CODER_SESSION ${second.sessionId}`))
    assert.equal(store.readManifest(dataDir, second.sessionId).awaitingAttach, false)
  } finally {
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

test('propose-patch without a file records live edits', async () => {
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
    const started = runCli(
      ['start-session', '--session', 'live-cli', '--name', 'Live CLI'],
      { cwd: root, env },
    )
    assert.equal(started.status, 0, started.stderr)
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    store.answerBlueprint(dataDir, 'live-cli', false)
    store.reportPlan(dataDir, {
      sessionId: 'live-cli',
      feature: 'Live CLI',
      stepTitles: ['Bump value'],
      targetRoot: target,
    })
    store.invokeStep(dataDir, 'live-cli', 1, target)
    fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 9\n')
    const result = runCli(['propose-patch', '--session', 'live-cli'], {
      cwd: root,
      env,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_STEP_READY/)
    assert.match(result.stdout, /Recorded live edits/)
    assert.equal(fs.readFileSync(path.join(target, 'src/a.ts'), 'utf8'), 'export const value = 9\n')
  } finally {
    cleanup()
  }
})

test('wait-for-blueprint prints an ack for the handshake', async () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const started = runCli(
      ['start-session', '--session', 'ack-blueprint', '--name', 'Ack blueprint'],
      { cwd: root, env },
    )
    assert.equal(started.status, 0, started.stderr)
    const result = runCli(['wait-for-blueprint', '--session', 'ack-blueprint'], {
      cwd: root,
      env,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK blueprint: none/)
    assert.match(result.stdout, /VISUAL_CODER_BLUEPRINT_READY/)
    assert.match(result.stdout, /VISUAL_CODER_LOCAL_BLUEPRINT_READY/)
    assert.doesNotMatch(result.stdout, /VISUAL_CODER_CONTEXT_FILES_START/)
  } finally {
    cleanup()
  }
})

test('wait-for-blueprint sends global plus that session color only', async () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    const coral = store.setupSession(dataDir, { sessionId: 'coral-dump' })
    const amber = store.setupSession(dataDir, { sessionId: 'amber-dump' })
    store.updateBlueprint(dataDir, null, {
      userCreatedBlocks: [
        {
          id: 'src/Global.tsx',
          name: 'Global.tsx',
          path: 'src/Global.tsx',
          folder: 'src',
          x: 1,
          z: 1,
        },
      ],
    })
    store.updateBlueprint(dataDir, coral.sessionId, {
      color: coral.color,
      userCreatedBlocks: [
        {
          id: 'src/Coral.tsx',
          name: 'Coral.tsx',
          path: 'src/Coral.tsx',
          folder: 'src',
          x: 2,
          z: 2,
        },
      ],
    })
    store.updateBlueprint(dataDir, amber.sessionId, {
      color: amber.color,
      userCreatedBlocks: [
        {
          id: 'src/Amber.tsx',
          name: 'Amber.tsx',
          path: 'src/Amber.tsx',
          folder: 'src',
          x: 3,
          z: 3,
        },
      ],
    })
    const coralDump = runCli(['wait-for-blueprint', '--session', 'coral-dump'], {
      cwd: root,
      env,
    })
    assert.equal(coralDump.status, 0, coralDump.stderr)
    const coralGlobal = coralDump.stdout.split('VISUAL_CODER_BLUEPRINT_END')[0]
    const coralLocal = coralDump.stdout.split('VISUAL_CODER_LOCAL_BLUEPRINT_START')[1]
    assert.match(coralGlobal, /src\/Global\.tsx/)
    assert.doesNotMatch(coralGlobal, /src\/Coral\.tsx/)
    assert.doesNotMatch(coralGlobal, /src\/Amber\.tsx/)
    assert.match(coralLocal, /src\/Coral\.tsx/)
    assert.doesNotMatch(coralLocal, /src\/Amber\.tsx/)
    assert.doesNotMatch(coralLocal, /src\/Global\.tsx/)

    const amberDump = runCli(['wait-for-blueprint', '--session', 'amber-dump'], {
      cwd: root,
      env,
    })
    assert.equal(amberDump.status, 0, amberDump.stderr)
    const amberGlobal = amberDump.stdout.split('VISUAL_CODER_BLUEPRINT_END')[0]
    const amberLocal = amberDump.stdout.split('VISUAL_CODER_LOCAL_BLUEPRINT_START')[1]
    assert.match(amberGlobal, /src\/Global\.tsx/)
    assert.doesNotMatch(amberGlobal, /src\/Coral\.tsx/)
    assert.doesNotMatch(amberGlobal, /src\/Amber\.tsx/)
    assert.match(amberLocal, /src\/Amber\.tsx/)
    assert.doesNotMatch(amberLocal, /src\/Coral\.tsx/)
    assert.doesNotMatch(amberLocal, /src\/Global\.tsx/)
  } finally {
    cleanup()
  }
})

test('wait-for-blueprint prints attached context files', async () => {
  const { root, cleanup } = tempProject()
  const dataDir = path.join(root, '.inbase')
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: root,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const started = runCli(
      ['start-session', '--session', 'ack-files', '--name', 'Ack files'],
      { cwd: root, env },
    )
    assert.equal(started.status, 0, started.stderr)
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    store.addContextFiles(dataDir, 'ack-files', {
      name: 'brief.md',
      mimeType: 'text/markdown',
      bytes: Buffer.from('Build a timer widget'),
    })
    const result = runCli(['wait-for-blueprint', '--session', 'ack-files'], {
      cwd: root,
      env,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_CONTEXT_FILES_START/)
    assert.match(result.stdout, /brief\.md/)
    assert.match(result.stdout, /VISUAL_CODER_CONTEXT_FILE_START brief.md/)
    assert.match(result.stdout, /Build a timer widget/)
    assert.match(result.stdout, /VISUAL_CODER_CONTEXT_FILE_END/)
  } finally {
    cleanup()
  }
})

test('wait-for-approval returns when the shared blueprint changes', async () => {
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
    const started = runCli(
      ['start-session', '--session', 'ack-blue-update', '--name', 'Ack blueprint update'],
      { cwd: root, env },
    )
    assert.equal(started.status, 0, started.stderr)
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    store.answerBlueprint(dataDir, 'ack-blue-update', false)
    store.reportPlan(dataDir, {
      sessionId: 'ack-blue-update',
      feature: 'Ack blueprint update',
      stepTitles: ['Bump value'],
      targetRoot: target,
    })
    store.updateBlueprint(dataDir, null, {
      userCreatedBlocks: [
        {
          id: 'src/New.tsx',
          name: 'New.tsx',
          path: 'src/New.tsx',
          folder: 'src',
          x: 1,
          z: 2,
        },
      ],
    })
    const result = runCli(
      ['wait-for-approval', '--session', 'ack-blue-update', '--timeout', '2000'],
      { cwd: root, env },
    )
    assert.equal(result.status, 6, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK blueprint:/)
    assert.match(result.stdout, /VISUAL_CODER_BLUEPRINT The global blueprint changed/)
    assert.match(result.stdout, /VISUAL_CODER_BLUEPRINT_START/)
  } finally {
    cleanup()
  }
})

test('wait-for-approval prints an execute ack without a waiting line', async () => {
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
    const started = runCli(
      ['start-session', '--session', 'ack-exec', '--name', 'Ack execute'],
      { cwd: root, env },
    )
    assert.equal(started.status, 0, started.stderr)
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    store.answerBlueprint(dataDir, 'ack-exec', false)
    store.reportPlan(dataDir, {
      sessionId: 'ack-exec',
      feature: 'Ack execute',
      stepTitles: ['Bump value'],
      targetRoot: target,
    })
    store.invokeStep(dataDir, 'ack-exec', 1, target)
    const result = runCli(
      ['wait-for-approval', '--session', 'ack-exec', '--timeout', '2000'],
      { cwd: root, env },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK execute: step 1 — Bump value/)
    assert.match(result.stdout, /VISUAL_CODER_EXECUTE Step 1 is invoked: Bump value/)
    assert.doesNotMatch(result.stdout, /Waiting for/)
    assert.equal(store.sessionIntent(dataDir, 'ack-exec').lastAck.kind, 'execute')
  } finally {
    cleanup()
  }
})

test('wait-for-approval returns as soon as accept invokes the next step', async () => {
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
    const started = runCli(
      ['start-session', '--session', 'fast-next', '--name', 'Fast next'],
      { cwd: root, env },
    )
    assert.equal(started.status, 0, started.stderr)
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    store.answerBlueprint(dataDir, 'fast-next', false)
    store.reportPlan(dataDir, {
      sessionId: 'fast-next',
      feature: 'Fast next',
      stepTitles: ['Bump value', 'Bump again'],
      targetRoot: target,
    })
    store.invokeStep(dataDir, 'fast-next', 1, target)
    store.appendDiff(dataDir, target, {
      sessionId: 'fast-next',
      patchText:
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 2\n',
    })

    const child = spawn(
      process.execPath,
      [path.join(packageRoot, 'bin/inbase.mjs'), 'wait-for-approval', '--session', 'fast-next', '--timeout', '5000'],
      { cwd: root, env, encoding: 'utf8' },
    )
    const pending = collectChild(child)
    await Promise.race([
      pending.ready,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('wait-for-approval never started')), 4000)
      }),
    ])
    const invokedAt = Date.now()
    store.invokeStep(dataDir, 'fast-next', 2, target)
    const result = await pending.closed
    const elapsed = Date.now() - invokedAt
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK execute: step 2 — Bump again/)
    assert.match(result.stdout, /Continue immediately/)
    assert.ok(elapsed < 2000, `next step took ${elapsed}ms`)
  } finally {
    cleanup()
  }
})

test('wait-for-approval returns explain when the user asks to explain a proposal', async () => {
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
    const started = runCli(
      ['start-session', '--session', 'explain-next', '--name', 'Explain next'],
      { cwd: root, env },
    )
    assert.equal(started.status, 0, started.stderr)
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    store.answerBlueprint(dataDir, 'explain-next', false)
    store.reportPlan(dataDir, {
      sessionId: 'explain-next',
      feature: 'Explain next',
      stepTitles: ['Bump value', 'Bump again'],
      targetRoot: target,
    })
    store.invokeStep(dataDir, 'explain-next', 1, target)
    const recorded = store.appendDiff(dataDir, target, {
      sessionId: 'explain-next',
      patchText:
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 2\n',
    })

    const child = spawn(
      process.execPath,
      [path.join(packageRoot, 'bin/inbase.mjs'), 'wait-for-approval', '--session', 'explain-next', '--timeout', '5000'],
      { cwd: root, env, encoding: 'utf8' },
    )
    const pending = collectChild(child)
    await Promise.race([
      pending.ready,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('wait-for-approval never started')), 4000)
      }),
    ])
    store.requestExplainProposal(dataDir, 'explain-next', recorded.entry.id)
    const result = await pending.closed
    assert.equal(result.status, 7, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK explain: the proposal for Bump value/)
    assert.match(result.stdout, /VISUAL_CODER_EXPLAIN/)
    assert.match(result.stdout, /Explain the current proposal: Bump value/)
    assert.equal(store.readManifest(dataDir, 'explain-next').pendingExplain, true)
    assert.equal(store.readManifest(dataDir, 'explain-next').phase, 'review')
    store.clearPendingExplain(dataDir, 'explain-next')
    assert.equal(store.readManifest(dataDir, 'explain-next').pendingExplain, false)
  } finally {
    cleanup()
  }
})

test('wait-for-approval returns explain from plan ready without a pending patch', async () => {
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
    const started = runCli(
      ['start-session', '--session', 'explain-plan', '--name', 'Explain plan'],
      { cwd: root, env },
    )
    assert.equal(started.status, 0, started.stderr)
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    store.answerBlueprint(dataDir, 'explain-plan', false)
    store.reportPlan(dataDir, {
      sessionId: 'explain-plan',
      feature: 'Explain plan',
      stepTitles: ['Bump value', 'Bump again'],
      targetRoot: target,
    })

    const child = spawn(
      process.execPath,
      [path.join(packageRoot, 'bin/inbase.mjs'), 'wait-for-approval', '--session', 'explain-plan', '--timeout', '5000'],
      { cwd: root, env, encoding: 'utf8' },
    )
    const pending = collectChild(child)
    await Promise.race([
      pending.ready,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('wait-for-approval never started')), 4000)
      }),
    ])
    store.requestExplainProposal(dataDir, 'explain-plan')
    const result = await pending.closed
    assert.equal(result.status, 7, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK explain: the proposal for Bump value/)
    assert.match(result.stdout, /VISUAL_CODER_EXPLAIN/)
    assert.match(result.stdout, /Explain the current proposal: Bump value/)
    assert.match(result.stdout, /still waiting for Create proposal/)
    assert.equal(store.readManifest(dataDir, 'explain-plan').pendingExplain, true)
    assert.equal(store.readManifest(dataDir, 'explain-plan').phase, 'plan_ready')
  } finally {
    cleanup()
  }
})

test('wait-for-approval returns explain when the user clicks Explain on a folder', async () => {
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
    const started = runCli(
      ['start-session', '--session', 'explain-folder', '--name', 'Explain folder'],
      { cwd: root, env },
    )
    assert.equal(started.status, 0, started.stderr)
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    const explain = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/explain-store.mjs')).href
    )
    store.answerBlueprint(dataDir, 'explain-folder', false)
    store.reportPlan(dataDir, {
      sessionId: 'explain-folder',
      feature: 'Explain folder',
      stepTitles: ['Bump value', 'Bump again'],
      targetRoot: target,
    })

    const child = spawn(
      process.execPath,
      [path.join(packageRoot, 'bin/inbase.mjs'), 'wait-for-approval', '--session', 'explain-folder', '--timeout', '5000'],
      { cwd: root, env, encoding: 'utf8' },
    )
    const pending = collectChild(child)
    await Promise.race([
      pending.ready,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('wait-for-approval never started')), 4000)
      }),
    ])
    explain.requestExplainTarget(dataDir, {
      kind: 'folder',
      path: 'apps/explorer/src',
    })
    const result = await pending.closed
    assert.equal(result.status, 7, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK explain: folder apps\/explorer\/src/)
    assert.match(result.stdout, /VISUAL_CODER_EXPLAIN/)
    assert.match(
      result.stdout,
      /Explain the function of the folder apps\/explorer\/src/,
    )
    assert.equal(explain.readExplain(dataDir).pendingStart, null)
    assert.equal(store.readManifest(dataDir, 'explain-folder').phase, 'plan_ready')
  } finally {
    cleanup()
  }
})

test('wait-for-blueprint returns explain when a map question mark is already pending', async () => {
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
    assert.equal(result.status, 7, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK explain: folder apps\/explorer\/scripts/)
    assert.match(result.stdout, /single-explanation card/)
    assert.equal(explain.readExplain(dataDir).pendingStart, null)
  } finally {
    cleanup()
  }
})

test('manifest gate keeps waiting after a watcher EMFILE error', async () => {
  const watcher = new EventEmitter()
  watcher.close = () => {}
  const errors = []
  const onError = (err) => errors.push(err)
  process.on('uncaughtException', onError)
  try {
    const gate = createManifestGate('/tmp/manifest.json', () => watcher)
    const started = Date.now()
    const waiting = gate.wait(1000)
    const err = new Error('EMFILE: too many open files, watch')
    err.code = 'EMFILE'
    watcher.emit('error', err)
    await waiting
    assert.ok(Date.now() - started < 200)
    assert.equal(errors.length, 0)
    gate.close()
  } finally {
    process.off('uncaughtException', onError)
  }
})

test('wait-for-approval still returns after invoke when fs.watch emits EMFILE', async () => {
  const { root, cleanup } = tempProject()
  const target = path.join(root, 'app')
  const dataDir = path.join(root, '.inbase')
  const preload = path.join(root, 'emfile-watch.mjs')
  fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'src/a.ts'), 'export const value = 1\n')
  fs.writeFileSync(
    preload,
    `import fs from 'node:fs'
import { EventEmitter } from 'node:events'
fs.watch = () => {
  const watcher = new EventEmitter()
  watcher.close = () => {}
  queueMicrotask(() => {
    const err = new Error('EMFILE: too many open files, watch')
    err.code = 'EMFILE'
    watcher.emit('error', err)
  })
  return watcher
}
`,
  )
  const env = {
    ...process.env,
    VISUAL_CODER_TARGET: target,
    INBASE_DATA_DIR: dataDir,
  }
  try {
    const started = runCli(
      ['start-session', '--session', 'emfile-wait', '--name', 'EMFILE wait'],
      { cwd: root, env },
    )
    assert.equal(started.status, 0, started.stderr)
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    store.answerBlueprint(dataDir, 'emfile-wait', false)
    store.reportPlan(dataDir, {
      sessionId: 'emfile-wait',
      feature: 'EMFILE wait',
      stepTitles: ['Bump value', 'Bump again'],
      targetRoot: target,
    })
    store.invokeStep(dataDir, 'emfile-wait', 1, target)
    store.appendDiff(dataDir, target, {
      sessionId: 'emfile-wait',
      patchText:
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 2\n',
    })

    const child = spawn(
      process.execPath,
      [
        '--import',
        pathToFileURL(preload).href,
        path.join(packageRoot, 'bin/inbase.mjs'),
        'wait-for-approval',
        '--session',
        'emfile-wait',
        '--timeout',
        '5000',
      ],
      { cwd: root, env, encoding: 'utf8' },
    )
    const pending = collectChild(child)
    await Promise.race([
      pending.ready,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('wait-for-approval never started')), 4000)
      }),
    ])
    const invokedAt = Date.now()
    store.invokeStep(dataDir, 'emfile-wait', 2, target)
    const result = await pending.closed
    const elapsed = Date.now() - invokedAt
    assert.equal(result.status, 0, result.stderr)
    assert.doesNotMatch(result.stderr, /EMFILE/)
    assert.match(result.stdout, /VISUAL_CODER_ACK execute: step 2 — Bump again/)
    assert.ok(elapsed < 2000, `next step took ${elapsed}ms`)
  } finally {
    cleanup()
  }
})

test('wait-for-approval timeout resets the visualizer session', async () => {
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
    const started = runCli(
      ['start-session', '--session', 'ack-timeout', '--name', 'Ack timeout'],
      { cwd: root, env },
    )
    assert.equal(started.status, 0, started.stderr)
    const store = await import(
      pathToFileURL(path.join(packageRoot, 'apps/explorer/scripts/session-store.mjs')).href
    )
    store.answerBlueprint(dataDir, 'ack-timeout', false)
    store.reportPlan(dataDir, {
      sessionId: 'ack-timeout',
      feature: 'Ack timeout',
      stepTitles: ['Bump value'],
      targetRoot: target,
    })
    const result = runCli(
      ['wait-for-approval', '--session', 'ack-timeout', '--timeout', '200'],
      { cwd: root, env },
    )
    assert.equal(result.status, 3, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_ACK timeout/)
    assert.match(result.stderr, /Timed out waiting for visualizer review/)
    assert.equal(store.readManifest(dataDir, 'ack-timeout'), null)
  } finally {
    cleanup()
  }
})
