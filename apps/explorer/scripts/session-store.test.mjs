import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  appendDiff,
  answerBlueprint,
  assertSessionId,
  clearDiffSessions,
  continueDiff,
  discardInactiveDiffSessions,
  inspectTargetFile,
  invokeStep,
  materializeDiff,
  listOpenSessionIds,
  listSessionIntents,
  readActiveSession,
  readBlueprint,
  readBlueprintSession,
  readDiff,
  readManifest,
  reportPlan,
  requestReplan,
  sendBlueprint,
  sessionIntent,
  setStepByStep,
  startSession,
  stopSession,
  touchSessionConnection,
  updateBlueprint,
  writeManifest,
  isSessionStopped,
  isWorkflowStopped,
} from './session-store.mjs'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-coder-test-'))
  const dataDir = path.join(root, 'data')
  const targetRoot = path.join(root, 'target')
  fs.mkdirSync(path.join(targetRoot, 'src'), { recursive: true })
  fs.writeFileSync(path.join(targetRoot, 'src/a.ts'), 'export const value = 1\n')
  return {
    root,
    dataDir,
    targetRoot,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}

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

const oneToTwo =
  '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 2\n'
const twoToThree =
  '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 2\n+export const value = 3\n'
const threeToFour =
  '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 3\n+export const value = 4\n'

test('rejects unsafe session identifiers', () => {
  assert.throws(() => assertSessionId('../other-chat'))
  assert.throws(() => assertSessionId('has spaces'))
  assert.equal(assertSessionId('chat_123-abc'), 'chat_123-abc')
})

test('starts a blueprint handshake before the LLM can prepare', () => {
  const env = fixture()
  try {
    const started = startSession(env.dataDir, { sessionId: 'prep-chat' })
    assert.equal(started.phase, 'blueprint_ask')
    assert.equal(readActiveSession(env.dataDir), 'prep-chat')

    const intent = sessionIntent(env.dataDir, 'prep-chat', ['src/a.ts'])
    assert.equal(intent.status, 'blueprint_ask')
    assert.equal(intent.working, false)
    assert.equal(intent.creationMode, false)
    assert.equal(intent.preview, false)
    assert.deepEqual(intent.steps, [])
    assert.equal(intent.diffId, null)

    const again = startSession(env.dataDir, { sessionId: 'prep-chat' })
    assert.equal(again.phase, 'blueprint_ask')

    assert.throws(() =>
      reportPlan(env.dataDir, {
        sessionId: 'prep-chat',
        feature: 'Prepared feature',
        stepTitles: ['Build value'],
      }),
    )

    answerBlueprint(env.dataDir, 'prep-chat', false)
    const skipped = sessionIntent(env.dataDir, 'prep-chat', ['src/a.ts'])
    assert.equal(skipped.status, 'preparing')
    assert.equal(skipped.working, true)
    assert.equal(skipped.creationMode, false)

    reportPlan(env.dataDir, {
      sessionId: 'prep-chat',
      feature: 'Prepared feature',
      stepTitles: ['Build value'],
    })
    const planned = sessionIntent(env.dataDir, 'prep-chat', ['src/a.ts'])
    assert.equal(planned.status, 'planned')
    assert.equal(planned.feature, 'Prepared feature')
    assert.equal(planned.working, false)
    assert.equal(planned.steps.length, 1)
  } finally {
    env.cleanup()
  }
})

test('shares user-placed files with the chat after Send blueprint', () => {
  const env = fixture()
  try {
    startSession(env.dataDir, { sessionId: 'blue-chat' })
    answerBlueprint(env.dataDir, 'blue-chat', true)
    const creating = sessionIntent(env.dataDir, 'blue-chat', ['src/a.ts'])
    assert.equal(creating.status, 'blueprint')
    assert.equal(creating.creationMode, true)
    assert.equal(creating.working, false)

    const before = readManifest(env.dataDir, 'blue-chat').updatedAt
    const block = {
      id: 'src/New.tsx',
      name: 'New.tsx',
      path: 'src/New.tsx',
      folder: 'src',
      x: 1,
      z: 2,
    }
    const island = {
      id: 'src/widgets',
      name: 'widgets',
      path: 'src/widgets',
      parent: 'src',
    }
    updateBlueprint(env.dataDir, 'blue-chat', {
      userCreatedBlocks: [block],
      userCreatedIslands: [island],
      addedFunctions: [{ name: 'Clock', file: 'src/New.tsx' }],
      addedVariables: [{ name: 'tick', file: 'src/a.ts' }],
      addedImports: [
        { name: 'Clock', from: 'src/New.tsx', file: 'src/a.ts' },
      ],
    })
    assert.equal(readManifest(env.dataDir, 'blue-chat').updatedAt, before)
    assert.throws(() =>
      reportPlan(env.dataDir, {
        sessionId: 'blue-chat',
        feature: 'Blueprint feature',
        stepTitles: ['Add New'],
      }),
    )

    sendBlueprint(env.dataDir, 'blue-chat')
    const sent = sessionIntent(env.dataDir, 'blue-chat', ['src/a.ts'])
    assert.equal(sent.status, 'preparing')
    assert.equal(sent.working, true)
    assert.equal(sent.creationMode, false)
    assert.deepEqual(sent.userCreatedBlocks, [block])
    assert.deepEqual(sent.userCreatedIslands, [island])
    assert.deepEqual(sent.blueprintFunctions, [
      { name: 'Clock', file: 'src/New.tsx' },
    ])
    assert.deepEqual(sent.blueprintVariables, [
      { name: 'tick', file: 'src/a.ts' },
    ])
    assert.deepEqual(sent.blueprintImports, [
      { name: 'Clock', from: 'src/New.tsx', file: 'src/a.ts' },
    ])
    assert.equal(readBlueprint(env.dataDir, 'blue-chat').sent, true)
  } finally {
    env.cleanup()
  }
})

test('allows only one blueprint edit session at a time', () => {
  const env = fixture()
  try {
    startSession(env.dataDir, { sessionId: 'edit-a' })
    answerBlueprint(env.dataDir, 'edit-a', true)
    assert.equal(readBlueprintSession(env.dataDir), 'edit-a')

    startSession(env.dataDir, { sessionId: 'edit-b' })
    assert.equal(readActiveSession(env.dataDir), 'edit-a')
    assert.deepEqual(listOpenSessionIds(env.dataDir), ['edit-a', 'edit-b'])
    assert.equal(listSessionIntents(env.dataDir, ['src/a.ts']).length, 2)

    assert.throws(() => answerBlueprint(env.dataDir, 'edit-b', true))
    const blocked = sessionIntent(env.dataDir, 'edit-b', ['src/a.ts'])
    assert.equal(blocked.canEnterBlueprint, false)
    assert.equal(blocked.creationMode, false)
    assert.equal(blocked.blueprintSessionId, 'edit-a')

    const editing = sessionIntent(env.dataDir, 'edit-a', ['src/a.ts'])
    assert.equal(editing.creationMode, true)
    assert.equal(editing.canEnterBlueprint, false)

    sendBlueprint(env.dataDir, 'edit-a')
    assert.equal(readBlueprintSession(env.dataDir), null)

    answerBlueprint(env.dataDir, 'edit-b', true)
    assert.equal(readBlueprintSession(env.dataDir), 'edit-b')
    const unlocked = sessionIntent(env.dataDir, 'edit-b', ['src/a.ts'])
    assert.equal(unlocked.creationMode, true)
  } finally {
    env.cleanup()
  }
})

test('lists every open LLM session so multiple prompts stay visible', () => {
  const env = fixture()
  try {
    startSession(env.dataDir, { sessionId: 'first-chat' })
    startSession(env.dataDir, { sessionId: 'second-chat' })
    assert.equal(readActiveSession(env.dataDir), 'second-chat')
    assert.deepEqual(listOpenSessionIds(env.dataDir), ['first-chat', 'second-chat'])

    const intents = listSessionIntents(env.dataDir, ['src/a.ts'])
    assert.equal(intents.length, 2)
    assert.deepEqual(
      intents.map((intent) => intent.sessionId),
      ['first-chat', 'second-chat'],
    )
    assert.ok(intents.every((intent) => intent.status === 'blueprint_ask'))

    answerBlueprint(env.dataDir, 'first-chat', false)
    reportPlan(env.dataDir, {
      sessionId: 'first-chat',
      feature: 'First feature',
      stepTitles: ['Build first'],
    })
    const afterPlan = listSessionIntents(env.dataDir, ['src/a.ts'])
    assert.equal(afterPlan.length, 2)
    assert.equal(
      afterPlan.find((intent) => intent.sessionId === 'first-chat')?.status,
      'planned',
    )
    assert.equal(
      afterPlan.find((intent) => intent.sessionId === 'second-chat')?.status,
      'blueprint_ask',
    )
  } finally {
    env.cleanup()
  }
})

test('hides finished and abandoned sessions that the LLM is not waiting on', () => {
  const env = fixture()
  const stale = '2026-01-01T00:00:00.000Z'
  try {
    startSession(env.dataDir, { sessionId: 'live-chat' })
    startSession(env.dataDir, { sessionId: 'old-review' })
    startSession(env.dataDir, { sessionId: 'old-finished' })
    startSession(env.dataDir, { sessionId: 'working-chat' })

    answerBlueprint(env.dataDir, 'old-review', false)
    reportPlan(env.dataDir, {
      sessionId: 'old-review',
      feature: 'Stale review',
      stepTitles: ['Build value'],
    })
    answerBlueprint(env.dataDir, 'working-chat', false)
    answerBlueprint(env.dataDir, 'old-finished', false)
    reportPlan(env.dataDir, {
      sessionId: 'old-finished',
      feature: 'Done feature',
      stepTitles: ['Build value'],
    })

    const finished = readManifest(env.dataDir, 'old-finished')
    finished.phase = 'finished'
    finished.status = 'finished'
    finished.createdAt = stale
    finished.updatedAt = stale
    fs.writeFileSync(
      path.join(env.dataDir, 'diff-sessions', 'old-finished', 'manifest.json'),
      `${JSON.stringify(finished, null, 2)}\n`,
    )

    for (const sessionId of ['old-review', 'working-chat']) {
      const manifest = readManifest(env.dataDir, sessionId)
      manifest.createdAt = stale
      manifest.updatedAt = stale
      fs.writeFileSync(
        path.join(env.dataDir, 'diff-sessions', sessionId, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
      )
    }

    assert.deepEqual(listOpenSessionIds(env.dataDir), ['working-chat', 'live-chat'])

    const live = readManifest(env.dataDir, 'live-chat')
    live.createdAt = stale
    live.updatedAt = stale
    fs.writeFileSync(
      path.join(env.dataDir, 'diff-sessions', 'live-chat', 'manifest.json'),
      `${JSON.stringify(live, null, 2)}\n`,
    )
    assert.deepEqual(listOpenSessionIds(env.dataDir), ['working-chat'])

    touchSessionConnection(env.dataDir, 'live-chat')
    assert.deepEqual(listOpenSessionIds(env.dataDir), ['live-chat', 'working-chat'])
  } finally {
    env.cleanup()
  }
})

test('reports a plan before invocation and exposes plan-only intent', () => {
  const env = fixture()
  try {
    reportPlan(env.dataDir, {
      sessionId: 'plan-chat',
      feature: 'Plan first',
      stepTitles: ['Build value', 'Finish value'],
    })
    const intent = sessionIntent(env.dataDir, 'plan-chat', ['src/a.ts'])
    assert.equal(intent.status, 'planned')
    assert.equal(intent.step, 1)
    assert.equal(intent.diffId, null)
    assert.equal(intent.preview, false)
    assert.throws(() =>
      appendDiff(env.dataDir, env.targetRoot, {
        sessionId: 'plan-chat',
        patchText: oneToTwo,
      }),
    )
  } finally {
    env.cleanup()
  }
})

test('invokes, reviews, continues, and waits to run the next step', () => {
  const env = fixture()
  try {
    reportPlan(env.dataDir, {
      sessionId: 'happy-chat',
      feature: 'Happy path',
      stepTitles: ['Build value', 'Finish value'],
    })
    invokeStep(env.dataDir, 'happy-chat', 1)
    assert.equal(readManifest(env.dataDir, 'happy-chat').phase, 'working')

    const first = appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'happy-chat',
      patchText: oneToTwo,
    })
    assert.equal(first.entry.step, 1)
    assert.equal(first.manifest.phase, 'review')
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 2\n',
    )

    invokeStep(env.dataDir, 'happy-chat', 2, env.targetRoot)
    const continued = readManifest(env.dataDir, 'happy-chat')
    assert.equal(continued.phase, 'working')
    assert.equal(continued.currentStep, 2)
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 2\n',
    )

    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'happy-chat',
      patchText:
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 2\n+export const value = 4\n',
    })
    invokeStep(env.dataDir, 'happy-chat', 2, env.targetRoot)
    assert.equal(readManifest(env.dataDir, 'happy-chat'), null)
    assert.equal(
      fs.existsSync(path.join(env.dataDir, 'diff-sessions', 'happy-chat')),
      false,
    )
  } finally {
    env.cleanup()
  }
})

test('step-by-step off runs remaining steps and waits on Complete', () => {
  const env = fixture()
  try {
    startSession(env.dataDir, { sessionId: 'auto-chat' })
    assert.equal(sessionIntent(env.dataDir, 'auto-chat').stepByStep, true)
    setStepByStep(env.dataDir, 'auto-chat', false)
    assert.equal(readManifest(env.dataDir, 'auto-chat').stepByStep, false)
    answerBlueprint(env.dataDir, 'auto-chat', false)

    const planned = reportPlan(env.dataDir, {
      sessionId: 'auto-chat',
      feature: 'Auto run',
      stepTitles: ['Build value', 'Finish value'],
    })
    assert.equal(planned.phase, 'working')
    assert.equal(planned.currentStep, 1)
    assert.equal(sessionIntent(env.dataDir, 'auto-chat').stepByStep, false)

    const first = appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'auto-chat',
      patchText: oneToTwo,
    })
    assert.equal(first.entry.step, 1)
    assert.equal(first.entry.status, 'applied')
    assert.equal(first.manifest.phase, 'working')
    assert.equal(first.manifest.currentStep, 2)
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 2\n',
    )

    const second = appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'auto-chat',
      patchText:
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 2\n+export const value = 4\n',
    })
    assert.equal(second.entry.step, 2)
    assert.equal(second.entry.status, 'pending')
    assert.equal(second.manifest.phase, 'review')
    const intent = sessionIntent(env.dataDir, 'auto-chat', ['src/a.ts'])
    assert.equal(intent.status, 'pending')
    assert.equal(intent.chain.length, 2)

    continueDiff(env.dataDir, env.targetRoot, 'auto-chat', '0002')
    assert.equal(readManifest(env.dataDir, 'auto-chat'), null)
  } finally {
    env.cleanup()
  }
})

test('turning step-by-step off at plan ready invokes the current step', () => {
  const env = fixture()
  try {
    reportPlan(env.dataDir, {
      sessionId: 'toggle-chat',
      feature: 'Toggle off',
      stepTitles: ['Build value', 'Finish value'],
    })
    assert.equal(readManifest(env.dataDir, 'toggle-chat').phase, 'plan_ready')
    const next = setStepByStep(env.dataDir, 'toggle-chat', false)
    assert.equal(next.phase, 'working')
    assert.equal(next.currentStep, 1)
  } finally {
    env.cleanup()
  }
})

test('turning step-by-step off during review continues into the next step', () => {
  const env = fixture()
  try {
    reportPlan(env.dataDir, {
      sessionId: 'review-toggle',
      feature: 'Toggle during review',
      stepTitles: ['Build value', 'Finish value'],
    })
    invokeStep(env.dataDir, 'review-toggle', 1)
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'review-toggle',
      patchText: oneToTwo,
    })
    assert.equal(readManifest(env.dataDir, 'review-toggle').phase, 'review')
    const next = setStepByStep(
      env.dataDir,
      'review-toggle',
      false,
      env.targetRoot,
    )
    assert.equal(next.phase, 'working')
    assert.equal(next.currentStep, 2)
    assert.equal(next.diffs[0].status, 'applied')
  } finally {
    env.cleanup()
  }
})

test('preview keeps earlier diffs visible as later steps accumulate', () => {
  const env = fixture()
  const addB =
    '--- /dev/null\n+++ b/src/b.ts\n@@ -0,0 +1,1 @@\n+export const extra = 1\n'
  try {
    reportPlan(env.dataDir, {
      sessionId: 'preview-chat',
      feature: 'Accumulated preview',
      stepTitles: ['Change value', 'Add extra'],
    })
    invokeStep(env.dataDir, 'preview-chat', 1)
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'preview-chat',
      patchText: oneToTwo,
    })
    const firstReview = sessionIntent(env.dataDir, 'preview-chat', ['src/a.ts'])
    assert.equal(firstReview.preview, true)
    assert.deepEqual(firstReview.files, ['src/a.ts'])
    assert.deepEqual(firstReview.creates, [])

    continueDiff(env.dataDir, env.targetRoot, 'preview-chat', '0001')
    const afterContinue = sessionIntent(env.dataDir, 'preview-chat', ['src/a.ts'])
    assert.equal(afterContinue.preview, true)
    assert.deepEqual(afterContinue.files, ['src/a.ts'])
    assert.deepEqual(afterContinue.creates, [])

    invokeStep(env.dataDir, 'preview-chat', 2)
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'preview-chat',
      patchText: addB,
    })

    const latest = sessionIntent(env.dataDir, 'preview-chat', [
      'src/a.ts',
      'src/b.ts',
    ])
    assert.equal(latest.preview, true)
    assert.deepEqual(latest.files, ['src/a.ts'])
    assert.deepEqual(latest.creates, ['src/b.ts'])
    assert.deepEqual(latest.createFolders, [])
    assert.equal(latest.diffId, '0002')

    continueDiff(env.dataDir, env.targetRoot, 'preview-chat', '0002')
    assert.equal(readManifest(env.dataDir, 'preview-chat'), null)
    assert.equal(sessionIntent(env.dataDir, 'preview-chat', ['src/a.ts']), null)
    assert.equal(
      fs.existsSync(path.join(env.dataDir, 'diff-sessions', 'preview-chat')),
      false,
    )
  } finally {
    env.cleanup()
  }
})

test('alternative instruction replaces the unfinished plan tail', () => {
  const env = fixture()
  try {
    reportPlan(env.dataDir, {
      sessionId: 'replan-chat',
      feature: 'Replan',
      stepTitles: ['Build value', 'Old second step'],
    })
    invokeStep(env.dataDir, 'replan-chat', 1)
    const first = appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'replan-chat',
      patchText: oneToTwo,
    })
    const firstText = readDiff(env.dataDir, 'replan-chat', first.entry)

    requestReplan(
      env.dataDir,
      'replan-chat',
      '0001',
      'Make the value configurable before finishing',
    )
    let manifest = readManifest(env.dataDir, 'replan-chat')
    assert.equal(manifest.phase, 'replanning')
    assert.equal(
      manifest.pendingInstruction,
      'Make the value configurable before finishing',
    )

    reportPlan(env.dataDir, {
      sessionId: 'replan-chat',
      feature: 'Replan',
      stepTitles: ['Revise value', 'Finish revised value'],
    })
    manifest = readManifest(env.dataDir, 'replan-chat')
    assert.equal(manifest.phase, 'plan_ready')
    assert.deepEqual(
      manifest.steps.map((step) => step.title),
      ['Revise value', 'Finish revised value'],
    )

    invokeStep(env.dataDir, 'replan-chat', 1)
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'replan-chat',
      patchText: twoToThree,
    })
    assert.equal(readDiff(env.dataDir, 'replan-chat', first.entry), firstText)
    continueDiff(env.dataDir, env.targetRoot, 'replan-chat', '0002')
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 3\n',
    )

    invokeStep(env.dataDir, 'replan-chat', 2)
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'replan-chat',
      patchText: threeToFour,
    })
    continueDiff(env.dataDir, env.targetRoot, 'replan-chat', '0003')
    assert.equal(readManifest(env.dataDir, 'replan-chat'), null)
  } finally {
    env.cleanup()
  }
})

test('rejects stale actions and invalid virtual continuations', () => {
  const env = fixture()
  try {
    reportPlan(env.dataDir, {
      sessionId: 'guard-chat',
      feature: 'Guards',
      stepTitles: ['Build value'],
    })
    assert.throws(() => invokeStep(env.dataDir, 'guard-chat', 2))
    invokeStep(env.dataDir, 'guard-chat', 1)
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'guard-chat',
      patchText: oneToTwo,
    })
    assert.throws(() =>
      continueDiff(env.dataDir, env.targetRoot, 'guard-chat', '9999'),
    )
    requestReplan(env.dataDir, 'guard-chat', '0001', 'Try another value')
    reportPlan(env.dataDir, {
      sessionId: 'guard-chat',
      feature: 'Guards',
      stepTitles: ['Try another value'],
    })
    invokeStep(env.dataDir, 'guard-chat', 1)
    assert.throws(() =>
      appendDiff(env.dataDir, env.targetRoot, {
        sessionId: 'guard-chat',
        patchText:
          '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 9\n',
      }),
    )
    stopSession(env.dataDir, 'guard-chat', env.targetRoot)
    assert.equal(readManifest(env.dataDir, 'guard-chat'), null)
    assert.equal(
      fs.existsSync(path.join(env.dataDir, 'diff-sessions', 'guard-chat')),
      false,
    )
  } finally {
    env.cleanup()
  }
})

test('preview lists new folders as added islands', () => {
  const env = fixture()
  const addNested =
    '--- /dev/null\n+++ b/src/games/arcade/Tetris.tsx\n@@ -0,0 +1,1 @@\n+export function Tetris() { return null }\n'
  try {
    reportPlan(env.dataDir, {
      sessionId: 'island-chat',
      feature: 'New island',
      stepTitles: ['Add arcade'],
    })
    invokeStep(env.dataDir, 'island-chat', 1)
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'island-chat',
      patchText: addNested,
    })
    const intent = sessionIntent(env.dataDir, 'island-chat', ['src/a.ts'])
    assert.deepEqual(intent.creates, ['src/games/arcade/Tetris.tsx'])
    assert.deepEqual(intent.createFolders, ['src/games', 'src/games/arcade'])
    assert.deepEqual(intent.addedFunctions, [
      { name: 'Tetris', file: 'src/games/arcade/Tetris.tsx' },
    ])
    assert.deepEqual(intent.addedVariables, [])
    assert.deepEqual(intent.addedImports, [])

    const sameFolder = sessionIntent(env.dataDir, 'island-chat', [
      'src/a.ts',
      'src/games/Keep.tsx',
    ])
    assert.deepEqual(sameFolder.createFolders, ['src/games/arcade'])

    const existingIsland = sessionIntent(env.dataDir, 'island-chat', [
      'src/a.ts',
      'src/games/arcade/Keep.tsx',
    ])
    assert.deepEqual(existingIsland.createFolders, [])

    const afterScan = sessionIntent(env.dataDir, 'island-chat', [
      'src/a.ts',
      'src/games/arcade/Tetris.tsx',
    ])
    assert.deepEqual(afterScan.createFolders, ['src/games', 'src/games/arcade'])
  } finally {
    env.cleanup()
  }
})

test('finished sessions discard stored blueprint drafts', () => {
  const env = fixture()
  try {
    startSession(env.dataDir, { sessionId: 'finish-blue' })
    answerBlueprint(env.dataDir, 'finish-blue', true)
    const block = {
      id: 'src/Draft.tsx',
      name: 'Draft.tsx',
      path: 'src/Draft.tsx',
      folder: 'src',
      x: 1,
      z: 2,
    }
    updateBlueprint(env.dataDir, 'finish-blue', {
      userCreatedBlocks: [block],
      addedFunctions: [{ name: 'Draft', file: 'src/Draft.tsx' }],
    })
    sendBlueprint(env.dataDir, 'finish-blue')
    reportPlan(env.dataDir, {
      sessionId: 'finish-blue',
      feature: 'Finish cleanup',
      stepTitles: ['Add draft file'],
    })
    invokeStep(env.dataDir, 'finish-blue', 1)
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'finish-blue',
      patchText:
        '--- /dev/null\n+++ b/src/Draft.tsx\n@@ -0,0 +1,3 @@\n+export function Draft() {\n+  return null\n+}\n',
    })
    continueDiff(env.dataDir, env.targetRoot, 'finish-blue', '0001')
    assert.equal(readManifest(env.dataDir, 'finish-blue'), null)
    assert.equal(
      fs.existsSync(path.join(env.dataDir, 'diff-sessions', 'finish-blue')),
      false,
    )
    assert.equal(readActiveSession(env.dataDir), null)
  } finally {
    env.cleanup()
  }
})

test('stop deletes the session plan, patches, and active pointer', () => {
  const env = fixture()
  try {
    reportPlan(env.dataDir, {
      sessionId: 'stop-chat',
      feature: 'Stop wipes session',
      stepTitles: ['Build value'],
    })
    invokeStep(env.dataDir, 'stop-chat', 1)
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'stop-chat',
      patchText: oneToTwo,
    })
    assert.equal(readActiveSession(env.dataDir), 'stop-chat')
    assert.ok(
      fs.existsSync(path.join(env.dataDir, 'diff-sessions', 'stop-chat', 'diffs', '0001.patch')),
    )

    assert.equal(stopSession(env.dataDir, 'stop-chat', env.targetRoot), null)
    assert.equal(readManifest(env.dataDir, 'stop-chat'), null)
    assert.equal(sessionIntent(env.dataDir, 'stop-chat', ['src/a.ts']), null)
    assert.equal(readActiveSession(env.dataDir), null)
    assert.equal(
      fs.existsSync(path.join(env.dataDir, 'diff-sessions', 'stop-chat')),
      false,
    )
    assert.equal(isSessionStopped(env.dataDir, 'stop-chat'), true)
    assert.equal(isWorkflowStopped(env.dataDir, 'stop-chat'), true)
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 1\n',
    )
    touchSessionConnection(env.dataDir, 'stop-chat')
    assert.equal(
      fs.existsSync(path.join(env.dataDir, 'diff-sessions', 'stop-chat')),
      false,
    )
    assert.equal(stopSession(env.dataDir, 'stop-chat', env.targetRoot), null)
  } finally {
    env.cleanup()
  }
})

test('stop removes leftover diff sessions that have no LLM waiter', () => {
  const env = fixture()
  try {
    fs.mkdirSync(path.join(env.dataDir, 'diff-sessions'), { recursive: true })
    fs.writeFileSync(path.join(env.dataDir, 'diff-sessions', '.gitkeep'), '')
    fs.writeFileSync(
      path.join(env.dataDir, 'diff-sessions', 'old-chat.stopped'),
      '{}\n',
    )
    reportPlan(env.dataDir, {
      sessionId: 'orphan-chat',
      feature: 'Orphan leftover',
      stepTitles: ['Build value'],
    })
    invokeStep(env.dataDir, 'orphan-chat', 1)
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'orphan-chat',
      patchText: oneToTwo,
    })
    reportPlan(env.dataDir, {
      sessionId: 'stop-chat',
      feature: 'Stop wipes leftovers',
      stepTitles: ['Build value'],
    })
    invokeStep(env.dataDir, 'stop-chat', 1)

    stopSession(env.dataDir, 'stop-chat', env.targetRoot)
    assert.equal(
      fs.existsSync(path.join(env.dataDir, 'diff-sessions', 'orphan-chat')),
      false,
    )
    assert.equal(
      fs.existsSync(path.join(env.dataDir, 'diff-sessions', 'old-chat.stopped')),
      false,
    )
    assert.equal(
      fs.existsSync(path.join(env.dataDir, 'diff-sessions', 'stop-chat')),
      false,
    )
    assert.equal(isSessionStopped(env.dataDir, 'stop-chat'), true)
    assert.equal(
      fs.existsSync(path.join(env.dataDir, 'diff-sessions', '.gitkeep')),
      true,
    )
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 1\n',
    )
  } finally {
    env.cleanup()
  }
})

test('startup sweep always clears the diff-sessions folder', () => {
  const env = fixture()
  try {
    fs.mkdirSync(path.join(env.dataDir, 'diff-sessions'), { recursive: true })
    fs.writeFileSync(path.join(env.dataDir, 'diff-sessions', '.gitkeep'), '')
    fs.writeFileSync(
      path.join(env.dataDir, 'diff-sessions', 'old-chat.stopped'),
      '{}\n',
    )
    fs.writeFileSync(path.join(env.dataDir, 'diff-sessions', 'junk.txt'), 'nope\n')
    reportPlan(env.dataDir, {
      sessionId: 'stale-chat',
      feature: 'Stale leftover',
      stepTitles: ['Build value'],
    })
    invokeStep(env.dataDir, 'stale-chat', 1)
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'stale-chat',
      patchText: oneToTwo,
    })
    reportPlan(env.dataDir, {
      sessionId: 'live-chat',
      feature: 'Keep live',
      stepTitles: ['Build value'],
    })
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 2\n',
    )

    clearDiffSessions(env.dataDir, env.targetRoot)
    assert.deepEqual(
      fs.readdirSync(path.join(env.dataDir, 'diff-sessions')),
      ['.gitkeep'],
    )
    assert.equal(readActiveSession(env.dataDir), null)
    assert.equal(readBlueprintSession(env.dataDir), null)
    assert.equal(readManifest(env.dataDir, 'live-chat'), null)
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 1\n',
    )
  } finally {
    env.cleanup()
  }
})

test('inactive sweep keeps sessions that still have an LLM waiter', () => {
  const env = fixture()
  try {
    reportPlan(env.dataDir, {
      sessionId: 'live-chat',
      feature: 'Keep live',
      stepTitles: ['Build value'],
    })
    reportPlan(env.dataDir, {
      sessionId: 'dead-chat',
      feature: 'Drop dead',
      stepTitles: ['Build value'],
    })

    assert.deepEqual(
      discardInactiveDiffSessions(
        env.dataDir,
        env.targetRoot,
        new Set(['live-chat']),
      ),
      ['live-chat'],
    )
    assert.equal(readManifest(env.dataDir, 'live-chat')?.feature, 'Keep live')
    assert.equal(readManifest(env.dataDir, 'dead-chat'), null)
    assert.equal(
      fs.existsSync(path.join(env.dataDir, 'diff-sessions', 'dead-chat')),
      false,
    )
  } finally {
    env.cleanup()
  }
})

test('stop reverts accepted diffs and the pending preview', () => {
  const env = fixture()
  const addB =
    '--- /dev/null\n+++ b/src/b.ts\n@@ -0,0 +1,1 @@\n+export const extra = 1\n'
  try {
    reportPlan(env.dataDir, {
      sessionId: 'keep-chat',
      feature: 'Revert accepted',
      stepTitles: ['Change value', 'Add extra'],
    })
    invokeStep(env.dataDir, 'keep-chat', 1)
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'keep-chat',
      patchText: oneToTwo,
    })
    continueDiff(env.dataDir, env.targetRoot, 'keep-chat', '0001')
    invokeStep(env.dataDir, 'keep-chat', 2)
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'keep-chat',
      patchText: addB,
    })
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 2\n',
    )
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/b.ts'), 'utf8'),
      'export const extra = 1\n',
    )

    stopSession(env.dataDir, 'keep-chat', env.targetRoot)
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 1\n',
    )
    assert.equal(fs.existsSync(path.join(env.targetRoot, 'src/b.ts')), false)
  } finally {
    env.cleanup()
  }
})

test('stop unstages reverted files from git', () => {
  const env = fixture()
  const addB =
    '--- /dev/null\n+++ b/src/b.ts\n@@ -0,0 +1,1 @@\n+export const extra = 1\n'
  try {
    runGit(env.root, ['init'])
    runGit(env.root, ['add', 'target'])
    runGit(env.root, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'init'])

    reportPlan(env.dataDir, {
      sessionId: 'stage-chat',
      feature: 'Unstage on stop',
      stepTitles: ['Change value', 'Add extra'],
    })
    invokeStep(env.dataDir, 'stage-chat', 1)
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'stage-chat',
      patchText: oneToTwo,
    })
    continueDiff(env.dataDir, env.targetRoot, 'stage-chat', '0001')
    invokeStep(env.dataDir, 'stage-chat', 2)
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'stage-chat',
      patchText: addB,
    })
    runGit(env.root, ['add', '-A'])
    assert.match(runGit(env.root, ['diff', '--cached', '--name-only']).stdout, /a\.ts/)
    assert.match(runGit(env.root, ['diff', '--cached', '--name-only']).stdout, /b\.ts/)

    stopSession(env.dataDir, 'stage-chat', env.targetRoot)
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 1\n',
    )
    assert.equal(fs.existsSync(path.join(env.targetRoot, 'src/b.ts')), false)
    assert.equal(runGit(env.root, ['diff', '--cached', '--name-only']).stdout.trim(), '')
  } finally {
    env.cleanup()
  }
})

test('stop during working blocks further LLM writes until start-session', () => {
  const env = fixture()
  try {
    reportPlan(env.dataDir, {
      sessionId: 'kill-chat',
      feature: 'Kill while working',
      stepTitles: ['Build value'],
    })
    invokeStep(env.dataDir, 'kill-chat', 1)
    assert.equal(readManifest(env.dataDir, 'kill-chat').phase, 'working')

    stopSession(env.dataDir, 'kill-chat', env.targetRoot)
    assert.equal(isWorkflowStopped(env.dataDir, 'kill-chat'), true)
    assert.throws(
      () =>
        reportPlan(env.dataDir, {
          sessionId: 'kill-chat',
          feature: 'Should not revive',
          stepTitles: ['Build value'],
        }),
      /VISUAL_CODER_STOPPED/,
    )
    assert.throws(
      () =>
        appendDiff(env.dataDir, env.targetRoot, {
          sessionId: 'kill-chat',
          patchText: oneToTwo,
        }),
      /VISUAL_CODER_STOPPED/,
    )
    assert.throws(
      () => invokeStep(env.dataDir, 'kill-chat', 1),
      /VISUAL_CODER_STOPPED/,
    )
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 1\n',
    )

    const restarted = startSession(env.dataDir, { sessionId: 'kill-chat' })
    assert.equal(restarted.phase, 'blueprint_ask')
    assert.equal(isSessionStopped(env.dataDir, 'kill-chat'), false)
    assert.equal(isWorkflowStopped(env.dataDir, 'kill-chat'), false)
  } finally {
    env.cleanup()
  }
})

test('inspecting a file materializes the selected diff into the editor path', () => {
  const env = fixture()
  try {
    reportPlan(env.dataDir, {
      sessionId: 'inspect-chat',
      feature: 'Inspect',
      stepTitles: ['Change value', 'Change again'],
    })
    invokeStep(env.dataDir, 'inspect-chat', 1)
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'inspect-chat',
      patchText: oneToTwo,
    })
    continueDiff(env.dataDir, env.targetRoot, 'inspect-chat', '0001')
    invokeStep(env.dataDir, 'inspect-chat', 2)
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'inspect-chat',
      patchText: twoToThree,
    })
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 3\n',
    )

    materializeDiff(env.dataDir, env.targetRoot, 'inspect-chat', '0001')
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 2\n',
    )

    const inspected = inspectTargetFile(env.dataDir, env.targetRoot, {
      sessionId: 'inspect-chat',
      diffId: '0002',
      fileId: 'src/a.ts',
    })
    assert.equal(inspected, path.join(env.targetRoot, 'src/a.ts'))
    assert.equal(fs.readFileSync(inspected, 'utf8'), 'export const value = 3\n')
  } finally {
    env.cleanup()
  }
})

test('publishes a patch without copying the rest of the target tree', () => {
  const env = fixture()
  try {
    fs.mkdirSync(path.join(env.targetRoot, 'node_modules/pkg'), { recursive: true })
    fs.writeFileSync(
      path.join(env.targetRoot, 'node_modules/pkg/index.js'),
      'export default 1\n',
    )
    fs.writeFileSync(
      path.join(env.targetRoot, 'package.json'),
      `${JSON.stringify({ name: 'target' }, null, 2)}\n`,
    )

    reportPlan(env.dataDir, {
      sessionId: 'cursor-copy-chat',
      feature: 'Avoid sandbox copy',
      stepTitles: ['Build value'],
    })
    invokeStep(env.dataDir, 'cursor-copy-chat', 1)
    const published = appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'cursor-copy-chat',
      patchText: oneToTwo,
    })
    assert.equal(published.entry.step, 1)
    assert.equal(published.manifest.phase, 'review')
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 2\n',
    )
  } finally {
    env.cleanup()
  }
})

test('flags a working session when the LLM is still waiting', () => {
  const env = fixture()
  try {
    reportPlan(env.dataDir, {
      sessionId: 'stall-chat',
      feature: 'Stalled wait',
      stepTitles: ['Build value'],
    })
    invokeStep(env.dataDir, 'stall-chat', 1)
    const fresh = sessionIntent(
      env.dataDir,
      'stall-chat',
      ['src/a.ts'],
      undefined,
      new Set(['stall-chat']),
    )
    assert.equal(fresh.working, true)
    assert.equal(fresh.stalledWait, false)

    const manifest = readManifest(env.dataDir, 'stall-chat')
    manifest.workStartedAt = new Date(Date.now() - 5_000).toISOString()
    writeManifest(env.dataDir, manifest)

    const stalled = sessionIntent(
      env.dataDir,
      'stall-chat',
      ['src/a.ts'],
      undefined,
      new Set(['stall-chat']),
    )
    assert.equal(stalled.stalledWait, true)
    const implementing = sessionIntent(
      env.dataDir,
      'stall-chat',
      ['src/a.ts'],
      undefined,
      new Set(),
    )
    assert.equal(implementing.stalledWait, false)
  } finally {
    env.cleanup()
  }
})
