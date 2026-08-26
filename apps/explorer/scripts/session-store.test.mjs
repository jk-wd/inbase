import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  appendDiff,
  answerBlueprint,
  assertSessionId,
  clearDiffSessions,
  continueDiff,
  discardInactiveDiffSessions,
  recoverOpenDiffSessions,
  inspectTargetFile,
  invokeStep,
  materializeDiff,
  listOpenSessionIds,
  listSessionIntents,
  readActiveSession,
  focusSession,
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
  setupSession,
  attachSession,
  listAttachQueue,
  nextAttachSessionId,
  setInitialInstruction,
  addContextFiles,
  removeContextFile,
  listContextFiles,
  contextFileHandshake,
  MAX_CONTEXT_FILES,
  MAX_CONTEXT_FILE_BYTES,
  maybeStartVisualizerHandshake,
  stopSession,
  touchSessionConnection,
  updateBlueprint,
  clearBlueprint,
  cleanupBlueprint,
  setBlueprintHidden,
  writeManifest,
  isSessionStopped,
  isWorkflowStopped,
} from './session-store.mjs'
import { initGitRepo, runGit } from './git-test.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function fixture({ git = false } = {}) {
  const root = fs.mkdtempSync(
    path.join(git ? repoRoot : os.tmpdir(), git ? '.tmp-session-' : 'visual-coder-test-'),
  )
  const dataDir = path.join(root, 'data')
  const targetRoot = path.join(root, 'target')
  fs.mkdirSync(path.join(targetRoot, 'src'), { recursive: true })
  fs.writeFileSync(path.join(targetRoot, 'src/a.ts'), 'export const value = 1\n')
  if (git) initGitRepo(root)
  return {
    root,
    dataDir,
    targetRoot,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}

const oneToTwo =
  '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 2\n'
const oneToThree =
  '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 3\n'
const oneToNine =
  '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 9\n'
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
    assert.equal(started.name, '')
    assert.equal(readActiveSession(env.dataDir), 'prep-chat')

    const intent = sessionIntent(env.dataDir, 'prep-chat', ['src/a.ts'])
    assert.equal(intent.status, 'blueprint_ask')
    assert.equal(intent.working, false)
    assert.equal(intent.creationMode, true)
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
    assert.equal(skipped.creationMode, true)

    reportPlan(env.dataDir, {
      sessionId: 'prep-chat',
      feature: 'Prepared feature',
      stepTitles: ['Build value'],
    })
    const planned = sessionIntent(env.dataDir, 'prep-chat', ['src/a.ts'])
    assert.equal(planned.status, 'planned')
    assert.equal(planned.feature, 'Prepared feature')
    assert.equal(planned.name, 'Prepared feature')
    assert.equal(planned.working, false)
    assert.equal(planned.steps.length, 1)
  } finally {
    env.cleanup()
  }
})

test('setup session opens blueprint placement with no LLM attached', () => {
  const env = fixture()
  try {
    const started = setupSession(env.dataDir)
    assert.match(started.sessionId, /^viz-[0-9a-f]+$/)
    assert.equal(started.phase, 'blueprint')
    assert.equal(started.awaitingAttach, true)
    assert.equal(readActiveSession(env.dataDir), started.sessionId)

    const intent = sessionIntent(env.dataDir, started.sessionId, ['src/a.ts'])
    assert.equal(intent.status, 'blueprint')
    assert.equal(intent.creationMode, true)
    assert.equal(intent.working, false)
    assert.equal(intent.llmIdle, true)
    assert.equal(intent.awaitingAttach, true)
    assert.equal(intent.initialInstruction, null)
  } finally {
    env.cleanup()
  }
})

test('stores an initial instruction for the LLM handshake', () => {
  const env = fixture()
  try {
    const started = setupSession(env.dataDir)
    assert.equal(started.initialInstruction, null)

    const saved = setInitialInstruction(
      env.dataDir,
      started.sessionId,
      'Add a settings page',
    )
    assert.equal(saved.initialInstruction, 'Add a settings page')
    const intent = sessionIntent(env.dataDir, started.sessionId)
    assert.equal(intent.initialInstruction, 'Add a settings page')

    const cleared = setInitialInstruction(env.dataDir, started.sessionId, '  ')
    assert.equal(cleared.initialInstruction, null)
    assert.throws(
      () =>
        setInitialInstruction(
          env.dataDir,
          started.sessionId,
          'x'.repeat(4001),
        ),
      /4000/,
    )
  } finally {
    env.cleanup()
  }
})

test('stores session context files for the LLM handshake', () => {
  const env = fixture()
  try {
    const started = setupSession(env.dataDir)
    assert.deepEqual(started.contextFiles, [])

    const saved = addContextFiles(env.dataDir, started.sessionId, {
      name: 'notes.md',
      mimeType: 'text/markdown',
      bytes: Buffer.from('# Goal\nAdd a clock\n'),
    })
    assert.equal(saved.contextFiles.length, 1)
    assert.equal(saved.contextFiles[0].name, 'notes.md')
    assert.equal(saved.contextFiles[0].mimeType, 'text/markdown')
    const listed = listContextFiles(env.dataDir, started.sessionId)
    assert.equal(listed.length, 1)
    assert.equal(
      fs.readFileSync(listed[0].path, 'utf8'),
      '# Goal\nAdd a clock\n',
    )
    const intent = sessionIntent(env.dataDir, started.sessionId)
    assert.equal(intent.contextFiles.length, 1)
    assert.equal(intent.contextFiles[0].name, 'notes.md')
    assert.equal(intent.contextFiles[0].id, listed[0].id)
    assert.equal(intent.contextFiles[0].storedName, undefined)

    const handshake = contextFileHandshake(env.dataDir, started.sessionId)
    assert.equal(handshake.files.length, 1)
    assert.equal(handshake.files[0].name, 'notes.md')
    assert.equal(handshake.files[0].path, listed[0].path)
    assert.equal(handshake.texts.length, 1)
    assert.equal(handshake.texts[0].content, '# Goal\nAdd a clock\n')

    addContextFiles(env.dataDir, started.sessionId, {
      name: '../escape.png',
      mimeType: 'image/png',
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]),
    })
    const withImage = listContextFiles(env.dataDir, started.sessionId)
    assert.equal(withImage.length, 2)
    assert.equal(withImage[1].name, 'escape.png')
    assert.equal(path.basename(withImage[1].path), withImage[1].storedName)
    assert.equal(
      path.dirname(withImage[1].path).endsWith(`${path.sep}context`),
      true,
    )
    const imageHandshake = contextFileHandshake(env.dataDir, started.sessionId)
    assert.equal(imageHandshake.files.length, 2)
    assert.equal(imageHandshake.texts.length, 1)

    const removed = removeContextFile(
      env.dataDir,
      started.sessionId,
      listed[0].id,
    )
    assert.equal(removed.contextFiles.length, 1)
    assert.equal(removed.contextFiles[0].name, 'escape.png')
    assert.equal(fs.existsSync(listed[0].path), false)

    assert.throws(
      () =>
        addContextFiles(env.dataDir, started.sessionId, {
          name: 'empty.txt',
          bytes: Buffer.alloc(0),
        }),
      /empty/,
    )
    assert.throws(
      () =>
        addContextFiles(env.dataDir, started.sessionId, {
          name: 'huge.bin',
          bytes: Buffer.alloc(MAX_CONTEXT_FILE_BYTES + 1),
        }),
      /bytes or smaller/,
    )
    assert.throws(
      () =>
        addContextFiles(
          env.dataDir,
          started.sessionId,
          Array.from({ length: MAX_CONTEXT_FILES }, (_, index) => ({
            name: `file-${index}.txt`,
            bytes: Buffer.from(`file ${index}`),
          })),
        ),
      /at most/,
    )
  } finally {
    env.cleanup()
  }
})

test('/inbase starts without waiting for a blueprint', () => {
  const env = fixture()
  try {
    const started = setupSession(env.dataDir)
    const begun = maybeStartVisualizerHandshake(env.dataDir, started.sessionId)
    assert.equal(begun.phase, 'preparing')
    const empty = readBlueprint(env.dataDir, started.sessionId)
    assert.equal(empty.sent, true)
    assert.equal(empty.enabled, false)

    startSession(env.dataDir, { sessionId: 'ask-chat', name: 'Ask' })
    const fromAsk = maybeStartVisualizerHandshake(env.dataDir, 'ask-chat')
    assert.equal(fromAsk.phase, 'preparing')
    assert.equal(readBlueprint(env.dataDir, 'ask-chat').sent, true)

    const withFiles = setupSession(env.dataDir)
    updateBlueprint(env.dataDir, withFiles.sessionId, {
      userCreatedBlocks: [
        {
          id: 'src/Widget.tsx',
          name: 'Widget.tsx',
          path: 'src/Widget.tsx',
          folder: 'src',
          x: 1,
          z: 2,
        },
      ],
    })
    maybeStartVisualizerHandshake(env.dataDir, withFiles.sessionId)
    assert.equal(readBlueprint(env.dataDir, withFiles.sessionId).enabled, true)
  } finally {
    env.cleanup()
  }
})

test('attach without an id uses the oldest waiting session', () => {
  const env = fixture()
  try {
    const first = setupSession(env.dataDir)
    const second = setupSession(env.dataDir)
    assert.equal(readActiveSession(env.dataDir), second.sessionId)
    assert.deepEqual(listAttachQueue(env.dataDir), [
      first.sessionId,
      second.sessionId,
    ])
    assert.equal(nextAttachSessionId(env.dataDir), first.sessionId)

    const attached = attachSession(env.dataDir)
    assert.equal(attached.sessionId, first.sessionId)
    assert.equal(attached.awaitingAttach, false)
    assert.equal(attached.phase, 'preparing')
    const intent = sessionIntent(env.dataDir, first.sessionId)
    assert.equal(intent.awaitingAttach, false)
    assert.equal(intent.llmIdle, false)
    assert.equal(intent.lastAck.kind, 'attached')

    const again = attachSession(env.dataDir, first.sessionId)
    assert.equal(again.sessionId, first.sessionId)
    assert.deepEqual(listAttachQueue(env.dataDir), [second.sessionId])
    assert.equal(readActiveSession(env.dataDir), first.sessionId)
  } finally {
    env.cleanup()
  }
})

test('attach skips already attached sessions and ignores window focus', () => {
  const env = fixture()
  try {
    const first = setupSession(env.dataDir)
    const second = setupSession(env.dataDir)
    attachSession(env.dataDir)
    focusSession(env.dataDir, first.sessionId)
    assert.equal(readActiveSession(env.dataDir), first.sessionId)
    assert.deepEqual(listAttachQueue(env.dataDir), [second.sessionId])

    const next = attachSession(env.dataDir)
    assert.equal(next.sessionId, second.sessionId)
    assert.equal(next.awaitingAttach, false)
    assert.deepEqual(listAttachQueue(env.dataDir), [])
    assert.equal(readActiveSession(env.dataDir), second.sessionId)
  } finally {
    env.cleanup()
  }
})

test('a newly created session waits behind older sessions in the attach queue', () => {
  const env = fixture()
  try {
    const first = setupSession(env.dataDir)
    const second = setupSession(env.dataDir)
    const newest = setupSession(env.dataDir)
    assert.equal(nextAttachSessionId(env.dataDir), first.sessionId)
    assert.deepEqual(listAttachQueue(env.dataDir), [
      first.sessionId,
      second.sessionId,
      newest.sessionId,
    ])

    attachSession(env.dataDir, first.sessionId)
    focusSession(env.dataDir, first.sessionId)
    assert.equal(nextAttachSessionId(env.dataDir), second.sessionId)
    assert.deepEqual(listAttachQueue(env.dataDir), [
      second.sessionId,
      newest.sessionId,
    ])

    const attached = attachSession(env.dataDir)
    assert.equal(attached.sessionId, second.sessionId)
    assert.equal(readManifest(env.dataDir, newest.sessionId).awaitingAttach, true)
  } finally {
    env.cleanup()
  }
})

test('attach fails when no visualizer session is waiting', () => {
  const env = fixture()
  try {
    assert.throws(() => attachSession(env.dataDir), /waiting to attach/)
    const started = setupSession(env.dataDir)
    attachSession(env.dataDir)
    focusSession(env.dataDir, started.sessionId)
    assert.throws(() => attachSession(env.dataDir), /waiting to attach/)
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
    assert.equal(sent.creationMode, true)
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

test('sessions share one blueprint across LLM chats', () => {
  const env = fixture()
  try {
    startSession(env.dataDir, { sessionId: 'edit-a' })
    answerBlueprint(env.dataDir, 'edit-a', true)
    const blockA = {
      id: 'src/A.tsx',
      name: 'A.tsx',
      path: 'src/A.tsx',
      folder: 'src',
      x: 1,
      z: 2,
    }
    updateBlueprint(env.dataDir, 'edit-a', { userCreatedBlocks: [blockA] })

    startSession(env.dataDir, { sessionId: 'edit-b' })
    assert.equal(readActiveSession(env.dataDir), 'edit-b')
    assert.deepEqual(listOpenSessionIds(env.dataDir), ['edit-a', 'edit-b'])
    assert.equal(listSessionIntents(env.dataDir, ['src/a.ts']).length, 2)

    answerBlueprint(env.dataDir, 'edit-b', true)
    const blockB = {
      id: 'src/B.tsx',
      name: 'B.tsx',
      path: 'src/B.tsx',
      folder: 'src',
      x: 3,
      z: 4,
    }
    updateBlueprint(env.dataDir, 'edit-b', { userCreatedBlocks: [blockB] })

    const editingA = sessionIntent(env.dataDir, 'edit-a', ['src/a.ts'])
    const editingB = sessionIntent(env.dataDir, 'edit-b', ['src/a.ts'])
    assert.equal(editingA.creationMode, true)
    assert.equal(editingB.creationMode, true)
    assert.deepEqual(editingA.userCreatedBlocks, [blockB])
    assert.deepEqual(editingB.userCreatedBlocks, [blockB])
    assert.deepEqual(readBlueprint(env.dataDir).userCreatedBlocks, [blockB])

    focusSession(env.dataDir, 'edit-a')
    assert.equal(readActiveSession(env.dataDir), 'edit-a')
  } finally {
    env.cleanup()
  }
})

test('keeps accepting placed files after the blueprint handshake', () => {
  const env = fixture()
  try {
    startSession(env.dataDir, { sessionId: 'later-chat' })
    answerBlueprint(env.dataDir, 'later-chat', true)
    sendBlueprint(env.dataDir, 'later-chat')
    reportPlan(env.dataDir, {
      sessionId: 'later-chat',
      feature: 'Later files',
      stepTitles: ['Add later file'],
    })
    const afterSend = {
      id: 'src/Later.tsx',
      name: 'Later.tsx',
      path: 'src/Later.tsx',
      folder: 'src',
      x: 5,
      z: 6,
    }
    updateBlueprint(env.dataDir, 'later-chat', {
      userCreatedBlocks: [afterSend],
    })
    const intent = sessionIntent(env.dataDir, 'later-chat', ['src/a.ts'])
    assert.equal(intent.status, 'planned')
    assert.equal(intent.creationMode, true)
    assert.deepEqual(intent.userCreatedBlocks, [afterSend])
    assert.equal(readBlueprint(env.dataDir, 'later-chat').enabled, true)
    assert.equal(readBlueprint(env.dataDir, 'later-chat').sent, true)

    startSession(env.dataDir, { sessionId: 'ask-chat' })
    updateBlueprint(env.dataDir, 'ask-chat', { userCreatedBlocks: [afterSend] })
    assert.deepEqual(readBlueprint(env.dataDir).userCreatedBlocks, [afterSend])

    startSession(env.dataDir, { sessionId: 'skip-chat' })
    answerBlueprint(env.dataDir, 'skip-chat', false)
    const skipped = {
      id: 'src/Skipped.tsx',
      name: 'Skipped.tsx',
      path: 'src/Skipped.tsx',
      folder: 'src',
      x: 7,
      z: 8,
    }
    updateBlueprint(env.dataDir, 'skip-chat', {
      userCreatedBlocks: [skipped],
    })
    const skipIntent = sessionIntent(env.dataDir, 'skip-chat', ['src/a.ts'])
    assert.equal(skipIntent.creationMode, true)
    assert.deepEqual(skipIntent.userCreatedBlocks, [skipped])
    assert.equal(readBlueprint(env.dataDir, 'skip-chat').enabled, true)
  } finally {
    env.cleanup()
  }
})

test('blueprint stays shared after a session finishes and can be cleaned up', () => {
  const env = fixture()
  try {
    const block = {
      id: 'src/a.ts',
      name: 'a.ts',
      path: 'src/a.ts',
      folder: 'src',
      x: 1,
      z: 2,
    }
    const pending = {
      id: 'src/New.tsx',
      name: 'New.tsx',
      path: 'src/New.tsx',
      folder: 'src',
      x: 3,
      z: 4,
    }
    const island = {
      id: 'src',
      name: 'src',
      path: 'src',
      parent: '.',
    }
    updateBlueprint(env.dataDir, null, {
      userCreatedBlocks: [block, pending],
      userCreatedIslands: [island],
      addedFunctions: [
        { name: 'Clock', file: 'src/New.tsx' },
        { name: 'value', file: 'src/a.ts' },
      ],
    })
    const cleaned = cleanupBlueprint(env.dataDir, ['src/a.ts'], ['src', '.'])
    assert.deepEqual(
      cleaned.userCreatedBlocks.map((item) => item.id),
      ['src/New.tsx'],
    )
    assert.deepEqual(cleaned.userCreatedIslands, [])
    assert.deepEqual(cleaned.addedFunctions, [
      { name: 'Clock', file: 'src/New.tsx' },
    ])
    assert.equal(cleaned.hidden, false)

    const hidden = setBlueprintHidden(env.dataDir, true)
    assert.equal(hidden.hidden, true)
    assert.equal(hidden.revision, cleaned.revision)

    const cleared = clearBlueprint(env.dataDir)
    assert.equal(cleared.enabled, false)
    assert.equal(cleared.hidden, true)
    assert.deepEqual(cleared.userCreatedBlocks, [])
    assert.ok(cleared.revision > hidden.revision)
  } finally {
    env.cleanup()
  }
})

test('pointers mark existing files for the LLM to keep in mind', () => {
  const env = fixture()
  try {
    const pointers = [
      { kind: 'file', path: 'src/a.ts' },
      { kind: 'folder', path: 'src' },
      { kind: 'function', path: 'src/a.ts', name: 'value' },
    ]
    const stored = updateBlueprint(env.dataDir, null, { pointers })
    assert.equal(stored.enabled, true)
    assert.deepEqual(stored.pointers, pointers)

    const cleaned = cleanupBlueprint(env.dataDir, ['src/a.ts'], ['src', '.'])
    assert.deepEqual(cleaned.pointers, pointers)
    assert.equal(cleaned.enabled, true)

    const cleared = clearBlueprint(env.dataDir)
    assert.deepEqual(cleared.pointers, [])
    assert.equal(cleared.enabled, false)
  } finally {
    env.cleanup()
  }
})

test('stores an LLM-generated name so concurrent sessions stay distinct', () => {
  const env = fixture()
  try {
    const named = startSession(env.dataDir, {
      sessionId: 'named-chat',
      name: '  Clock on Home  ',
    })
    assert.equal(named.name, 'Clock on Home')
    assert.equal(named.feature, 'Clock on Home')
    assert.equal(
      sessionIntent(env.dataDir, 'named-chat')?.name,
      'Clock on Home',
    )

    const resumed = startSession(env.dataDir, {
      sessionId: 'named-chat',
      name: 'Home clock',
    })
    assert.equal(resumed.name, 'Home clock')
    assert.equal(
      sessionIntent(env.dataDir, 'named-chat')?.name,
      'Home clock',
    )

    startSession(env.dataDir, {
      sessionId: 'other-chat',
      name: 'Login redirect',
    })
    const intents = listSessionIntents(env.dataDir)
    assert.deepEqual(
      intents.map((intent) => intent.name),
      ['Home clock', 'Login redirect'],
    )
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

test('hides finished sessions but keeps review and handshake sessions without a waiter', () => {
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

    for (const sessionId of ['old-review', 'working-chat', 'live-chat']) {
      const manifest = readManifest(env.dataDir, sessionId)
      manifest.createdAt = stale
      manifest.updatedAt = stale
      fs.writeFileSync(
        path.join(env.dataDir, 'diff-sessions', sessionId, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
      )
    }

    assert.deepEqual(listOpenSessionIds(env.dataDir), [
      'live-chat',
      'old-review',
      'working-chat',
    ])
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
    assert.equal(sessionIntent(env.dataDir, 'happy-chat').lastAck.kind, 'invoke')
    assert.match(sessionIntent(env.dataDir, 'happy-chat').lastAck.detail, /step 1/)

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

test('alternative instruction keeps the current proposal on disk', () => {
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
      env.targetRoot,
    )
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 2\n',
    )
    const kept = sessionIntent(env.dataDir, 'replan-chat', ['src/a.ts'])
    assert.equal(kept.preview, true)
    assert.deepEqual(kept.files, ['src/a.ts'])
    const manifest = readManifest(env.dataDir, 'replan-chat')
    assert.equal(manifest.phase, 'working')
    assert.equal(
      manifest.pendingInstruction,
      'Make the value configurable before finishing',
    )
    assert.deepEqual(
      manifest.steps.map((step) => step.title),
      ['Build value', 'Old second step'],
    )

    const revised = appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'replan-chat',
      patchText: oneToThree,
    })
    assert.equal(readDiff(env.dataDir, 'replan-chat', first.entry), firstText)
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 3\n',
    )
    const replacement = sessionIntent(env.dataDir, 'replan-chat', ['src/a.ts'])
    assert.deepEqual(replacement.files, ['src/a.ts'])
    assert.equal(replacement.diffId, revised.entry.id)
    assert.equal(replacement.status, 'pending')
    assert.equal(replacement.phase, 'review')
    assert.equal(replacement.step, 1)
    assert.equal(replacement.chain.at(-1).status, 'pending')
    assert.equal(replacement.chain.at(-1).step, 1)
    assert.equal(
      replacement.chain.filter((entry) => entry.status === 'applied').length,
      0,
    )
    materializeDiff(env.dataDir, env.targetRoot, 'replan-chat', '0001')
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 2\n',
    )
    materializeDiff(env.dataDir, env.targetRoot, 'replan-chat', '0002')
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 3\n',
    )
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

test('revised proposal stays on the same step instead of advancing', () => {
  const env = fixture()
  try {
    reportPlan(env.dataDir, {
      sessionId: 'revise-stay',
      feature: 'Stay',
      stepTitles: ['Build value', 'Finish value'],
    })
    invokeStep(env.dataDir, 'revise-stay', 1)
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'revise-stay',
      patchText: oneToTwo,
    })
    requestReplan(
      env.dataDir,
      'revise-stay',
      '0001',
      'Use three instead',
      env.targetRoot,
    )
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'revise-stay',
      patchText: oneToThree,
    })
    const intent = sessionIntent(env.dataDir, 'revise-stay', ['src/a.ts'])
    assert.equal(intent.status, 'pending')
    assert.equal(intent.step, 1)
    assert.equal(intent.chain.at(-1).status, 'pending')

    setStepByStep(env.dataDir, 'revise-stay', false, env.targetRoot)
    const after = readManifest(env.dataDir, 'revise-stay')
    assert.equal(after.phase, 'review')
    assert.equal(after.currentStep, 1)
    assert.equal(after.diffs.at(-1).status, 'pending')
    const still = sessionIntent(env.dataDir, 'revise-stay', ['src/a.ts'])
    assert.equal(still.status, 'pending')
    assert.equal(still.step, 1)
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
    requestReplan(
      env.dataDir,
      'guard-chat',
      '0001',
      'Try another value',
      env.targetRoot,
    )
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 2\n',
    )
    assert.throws(() =>
      reportPlan(env.dataDir, {
        sessionId: 'guard-chat',
        feature: 'Guards',
        stepTitles: ['Try another value'],
      }),
    )
    assert.throws(() => invokeStep(env.dataDir, 'guard-chat', 1))
    assert.throws(() =>
      appendDiff(env.dataDir, env.targetRoot, {
        sessionId: 'guard-chat',
        patchText: twoToThree,
      }),
    )
    const replaced = appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'guard-chat',
      patchText: oneToNine,
    })
    assert.equal(replaced.entry.step, 1)
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 9\n',
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

test('stop keeps other open sessions and only drops finished leftovers', () => {
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
      true,
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
      'export const value = 2\n',
    )
  } finally {
    env.cleanup()
  }
})

test('explicit clear still wipes the diff-sessions folder', () => {
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

test('inactive sweep keeps open sessions even without an LLM waiter', () => {
  const env = fixture()
  try {
    reportPlan(env.dataDir, {
      sessionId: 'live-chat',
      feature: 'Keep live',
      stepTitles: ['Build value'],
    })
    reportPlan(env.dataDir, {
      sessionId: 'idle-chat',
      feature: 'Keep idle',
      stepTitles: ['Build value'],
    })
    const finished = reportPlan(env.dataDir, {
      sessionId: 'done-chat',
      feature: 'Drop finished',
      stepTitles: ['Build value'],
    })
    finished.phase = 'finished'
    finished.status = 'finished'
    writeManifest(env.dataDir, finished)

    const kept = discardInactiveDiffSessions(
      env.dataDir,
      env.targetRoot,
      new Set(['live-chat']),
    )
    assert.deepEqual(kept.sort(), ['idle-chat', 'live-chat'])
    assert.equal(readManifest(env.dataDir, 'live-chat')?.feature, 'Keep live')
    assert.equal(readManifest(env.dataDir, 'idle-chat')?.feature, 'Keep idle')
    assert.equal(readManifest(env.dataDir, 'done-chat'), null)
  } finally {
    env.cleanup()
  }
})

test('last-step review stays on the map after the LLM waiter disappears', () => {
  const env = fixture()
  const stale = '2026-01-01T00:00:00.000Z'
  try {
    startSession(env.dataDir, { sessionId: 'usecase-chat' })
    setStepByStep(env.dataDir, 'usecase-chat', false)
    answerBlueprint(env.dataDir, 'usecase-chat', false)
    reportPlan(env.dataDir, {
      sessionId: 'usecase-chat',
      feature: 'Auto run',
      stepTitles: ['Build value', 'Finish value'],
    })
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'usecase-chat',
      patchText: oneToTwo,
    })
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'usecase-chat',
      patchText:
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 2\n+export const value = 4\n',
    })

    const review = readManifest(env.dataDir, 'usecase-chat')
    assert.equal(review.phase, 'review')
    assert.equal(review.diffs.at(-1).step, 2)
    review.createdAt = stale
    review.updatedAt = stale
    fs.writeFileSync(
      path.join(env.dataDir, 'diff-sessions', 'usecase-chat', 'manifest.json'),
      `${JSON.stringify(review, null, 2)}\n`,
    )

    assert.deepEqual(listOpenSessionIds(env.dataDir), ['usecase-chat'])
    const intent = sessionIntent(env.dataDir, 'usecase-chat', ['src/a.ts'])
    assert.equal(intent.status, 'pending')
    assert.equal(intent.preview, true)
    assert.equal(intent.llmIdle, true)
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 4\n',
    )

    discardInactiveDiffSessions(env.dataDir, env.targetRoot, new Set())
    assert.equal(readManifest(env.dataDir, 'usecase-chat').phase, 'review')
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 4\n',
    )
  } finally {
    env.cleanup()
  }
})

test('visualizer startup discards leftover LLM sessions', () => {
  const env = fixture()
  try {
    startSession(env.dataDir, { sessionId: 'boot-chat' })
    setStepByStep(env.dataDir, 'boot-chat', false)
    answerBlueprint(env.dataDir, 'boot-chat', false)
    reportPlan(env.dataDir, {
      sessionId: 'boot-chat',
      feature: 'Leftover session',
      stepTitles: ['Build value'],
    })
    appendDiff(env.dataDir, env.targetRoot, {
      sessionId: 'boot-chat',
      patchText: oneToTwo,
    })
    assert.equal(readActiveSession(env.dataDir), 'boot-chat')
    assert.deepEqual(listOpenSessionIds(env.dataDir), ['boot-chat'])
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 2\n',
    )

    assert.deepEqual(recoverOpenDiffSessions(env.dataDir, env.targetRoot), [])
    assert.equal(readManifest(env.dataDir, 'boot-chat'), null)
    assert.deepEqual(listOpenSessionIds(env.dataDir), [])
    assert.equal(readActiveSession(env.dataDir), null)
    assert.equal(readBlueprintSession(env.dataDir), null)
    assert.equal(
      fs.existsSync(path.join(env.dataDir, 'diff-sessions', 'boot-chat')),
      false,
    )
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 1\n',
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
  const env = fixture({ git: true })
  const addB =
    '--- /dev/null\n+++ b/src/b.ts\n@@ -0,0 +1,1 @@\n+export const extra = 1\n'
  try {
    runGit(env.root, ['add', 'target'])
    runGit(env.root, ['commit', '-m', 'init'])

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

test('records live file edits against the invoke snapshot', () => {
  const env = fixture()
  try {
    startSession(env.dataDir, { sessionId: 'live-chat', name: 'Live edits' })
    answerBlueprint(env.dataDir, 'live-chat', false)
    reportPlan(env.dataDir, {
      sessionId: 'live-chat',
      feature: 'Live edits',
      stepTitles: ['Bump value', 'Add helper'],
      targetRoot: env.targetRoot,
    })
    invokeStep(env.dataDir, 'live-chat', 1, env.targetRoot)
    fs.writeFileSync(path.join(env.targetRoot, 'src/a.ts'), 'export const value = 2\n')

    const first = appendDiff(env.dataDir, env.targetRoot, { sessionId: 'live-chat' })
    assert.equal(first.entry.step, 1)
    assert.equal(first.manifest.phase, 'review')
    assert.match(readDiff(env.dataDir, 'live-chat', first.entry), /export const value = 2/)
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 2\n',
    )

    invokeStep(env.dataDir, 'live-chat', 2, env.targetRoot)
    fs.writeFileSync(
      path.join(env.targetRoot, 'src/helper.ts'),
      'export function helper() { return 2 }\n',
    )
    const second = appendDiff(env.dataDir, env.targetRoot, { sessionId: 'live-chat' })
    assert.equal(second.entry.step, 2)
    assert.match(readDiff(env.dataDir, 'live-chat', second.entry), /export function helper/)
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 2\n',
    )
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/helper.ts'), 'utf8'),
      'export function helper() { return 2 }\n',
    )

    materializeDiff(env.dataDir, env.targetRoot, 'live-chat', first.entry.id)
    assert.equal(
      fs.readFileSync(path.join(env.targetRoot, 'src/a.ts'), 'utf8'),
      'export const value = 2\n',
    )
    assert.equal(fs.existsSync(path.join(env.targetRoot, 'src/helper.ts')), false)
  } finally {
    env.cleanup()
  }
})

test('refuses to record a live step with no file changes', () => {
  const env = fixture()
  try {
    startSession(env.dataDir, { sessionId: 'empty-live', name: 'Empty live' })
    answerBlueprint(env.dataDir, 'empty-live', false)
    reportPlan(env.dataDir, {
      sessionId: 'empty-live',
      feature: 'Empty live',
      stepTitles: ['Do nothing'],
      targetRoot: env.targetRoot,
    })
    invokeStep(env.dataDir, 'empty-live', 1, env.targetRoot)
    assert.throws(
      () => appendDiff(env.dataDir, env.targetRoot, { sessionId: 'empty-live' }),
      /No file changes/,
    )
  } finally {
    env.cleanup()
  }
})
