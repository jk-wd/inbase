import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  appendDiff,
  answerBlueprint,
  assertSessionId,
  continueDiff,
  invokeStep,
  readActiveSession,
  readBlueprint,
  readBlueprintSession,
  readDiff,
  readManifest,
  reportPlan,
  requestReplan,
  sendBlueprint,
  sessionIntent,
  startSession,
  stopSession,
  updateBlueprint,
} from './session-store.mjs'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-coder-test-'))
  const dataDir = path.join(root, 'data')
  const targetRoot = path.join(root, 'target')
  fs.mkdirSync(path.join(targetRoot, 'src'), { recursive: true })
  fs.writeFileSync(path.join(targetRoot, 'src/a.ts'), 'export const value = 1\n')
  return {
    dataDir,
    targetRoot,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  }
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
    stopSession(env.dataDir, 'guard-chat')
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

    assert.equal(stopSession(env.dataDir, 'stop-chat', '0001'), null)
    assert.equal(readManifest(env.dataDir, 'stop-chat'), null)
    assert.equal(sessionIntent(env.dataDir, 'stop-chat', ['src/a.ts']), null)
    assert.equal(readActiveSession(env.dataDir), null)
    assert.equal(
      fs.existsSync(path.join(env.dataDir, 'diff-sessions', 'stop-chat')),
      false,
    )
    assert.equal(stopSession(env.dataDir, 'stop-chat'), null)
  } finally {
    env.cleanup()
  }
})
