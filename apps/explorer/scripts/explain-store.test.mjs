import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  mergeExplainPoll,
  emptyExplain,
  parseExplainArgs,
  parseExplainCli,
  readExplain,
  reportExplain,
  setExplainStep,
  startExplain,
  stopExplain,
  askExplainQuestion,
  consumeExplainQuestion,
  consumeExplainStart,
  explainTargetQuestion,
  requestExplainTarget,
} from './explain-store.mjs'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbase-explain-'))
  const dataDir = path.join(root, 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  return {
    dataDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}

test('parseExplainArgs groups flags under each --step', () => {
  const parsed = parseExplainArgs([
    '--question',
    'How does login work?',
    '--step',
    'Login handler',
    '--body',
    'Requests hit login.ts.',
    '--files',
    'src/auth/login.ts,src/auth/session.ts',
    '--folders',
    'src/auth',
    '--select',
    'src/auth/login.ts',
    '--zoom',
    'src/auth',
    '--relations',
    'src/auth/login.ts:src/auth/session.ts',
    '--step',
    'Callers',
    '--body',
    'Who imports login.',
    '--select',
    'src/auth/login.ts',
    '--imported-by',
  ])
  assert.equal(parsed.question, 'How does login work?')
  assert.equal(parsed.steps.length, 2)
  assert.equal(parsed.steps[0].title, 'Login handler')
  assert.deepEqual(parsed.steps[0].files, [
    'src/auth/login.ts',
    'src/auth/session.ts',
  ])
  assert.deepEqual(parsed.steps[0].folders, ['src/auth'])
  assert.equal(parsed.steps[0].select, 'src/auth/login.ts')
  assert.equal(parsed.steps[0].zoom, 'src/auth')
  assert.deepEqual(parsed.steps[0].relations, [
    { from: 'src/auth/login.ts', to: 'src/auth/session.ts' },
  ])
  assert.equal(parsed.steps[0].info, false)
  assert.deepEqual(parsed.steps[0].highlights, [])
  assert.equal(parsed.steps[0].point, null)
  assert.equal(parsed.steps[1].importedBy, true)
  assert.equal(parsed.steps[1].select, 'src/auth/login.ts')
})

test('parseExplainArgs opens the info panel and points at a symbol', () => {
  const parsed = parseExplainArgs([
    '--step',
    'App owns explain state',
    '--files',
    'apps/explorer/src/App.tsx',
    '--info',
    '--highlight',
    'function:currentExplainStep,variable:explain',
    '--point',
    'function:goExplainStep',
  ])
  assert.equal(parsed.steps[0].info, true)
  assert.equal(parsed.steps[0].select, 'apps/explorer/src/App.tsx')
  assert.deepEqual(parsed.steps[0].highlights, [
    { kind: 'function', name: 'currentExplainStep' },
    { kind: 'variable', name: 'explain' },
  ])
  assert.deepEqual(parsed.steps[0].point, {
    kind: 'function',
    name: 'goExplainStep',
  })
})

test('parseExplainArgs --info path selects that file', () => {
  const parsed = parseExplainArgs([
    '--step',
    'File structure',
    '--info',
    'apps/explorer/src/explain.ts',
    '--point',
    'file',
  ])
  assert.equal(parsed.steps[0].info, true)
  assert.equal(parsed.steps[0].select, 'apps/explorer/src/explain.ts')
  assert.deepEqual(parsed.steps[0].files, ['apps/explorer/src/explain.ts'])
  assert.deepEqual(parsed.steps[0].point, { kind: 'file', name: '' })
})

test('parseExplainCli maps start, report, wait, and stop', () => {
  assert.deepEqual(parseExplainCli(['stop']), { action: 'stop' })
  assert.deepEqual(parseExplainCli(['wait']), { action: 'wait' })
  assert.deepEqual(parseExplainCli(['start', '--question', 'What is World?']), {
    action: 'start',
    question: 'What is World?',
  })
  const reported = parseExplainCli([
    'report',
    '--question',
    'What is World?',
    '--step',
    'World layout',
    '--body',
    'World places folders.',
    '--files',
    'apps/explorer/src/scene/World.tsx',
  ])
  assert.equal(reported.action, 'report')
  if (reported.action !== 'report') return
  assert.equal(reported.parent, '')
  assert.equal(reported.steps[0].title, 'World layout')
  assert.equal(reported.steps[0].index, '1')

  const followUp = parseExplainCli([
    'report',
    '--parent',
    '7',
    '--question',
    'Why App.tsx?',
    '--step',
    'App owns explain state',
  ])
  assert.equal(followUp.action, 'report')
  if (followUp.action !== 'report') return
  assert.equal(followUp.parent, '7')
  assert.equal(followUp.question, 'Why App.tsx?')
})

test('start, report, set step, and stop persist explain.json', () => {
  const env = fixture()
  try {
    assert.deepEqual(readExplain(env.dataDir), emptyExplain())
    const started = startExplain(env.dataDir, 'How does login work?')
    assert.equal(started.active, true)
    assert.equal(started.presentation, 'walk')
    assert.equal(started.question, 'How does login work?')
    assert.equal(started.steps.length, 0)

    const reported = reportExplain(env.dataDir, {
      question: 'How does login work?',
      steps: [
        { title: 'Login handler', files: ['src/auth/login.ts'] },
        { title: 'Session store', folders: ['src/auth'] },
      ],
    })
    assert.equal(reported.steps.length, 2)
    assert.equal(reported.currentStep, '1')
    assert.equal(reported.steps[0].index, '1')
    assert.equal(reported.steps[1].index, '2')

    const moved = setExplainStep(env.dataDir, 2)
    assert.equal(moved.currentStep, '2')

    const rereported = reportExplain(env.dataDir, {
      question: 'How does login work?',
      steps: [
        { title: 'Login handler', files: ['src/auth/login.ts'] },
        { title: 'Session store', folders: ['src/auth'] },
        { title: 'Callers', select: 'src/auth/login.ts' },
      ],
    })
    assert.equal(rereported.steps.length, 3)
    assert.equal(rereported.currentStep, '2')

    const stopped = stopExplain(env.dataDir)
    assert.equal(stopped.active, false)
    assert.equal(stopped.steps.length, 0)
  } finally {
    env.cleanup()
  }
})

test('requestExplainTarget starts explain mode for a file or folder', () => {
  const env = fixture()
  try {
    const question = explainTargetQuestion('file', 'apps/explorer/src/App.tsx')
    assert.match(question, /file apps\/explorer\/src\/App\.tsx/)
    assert.match(question, /where it fits in the codebase/)

    const started = requestExplainTarget(env.dataDir, {
      kind: 'folder',
      path: 'apps/explorer/src',
    })
    assert.equal(started.active, true)
    assert.equal(started.presentation, 'card')
    assert.equal(started.steps.length, 0)
    assert.equal(started.pendingStart.kind, 'folder')
    assert.equal(started.pendingStart.path, 'apps/explorer/src')
    assert.equal(
      started.question,
      explainTargetQuestion('folder', 'apps/explorer/src'),
    )

    const consumed = consumeExplainStart(env.dataDir)
    assert.equal(consumed.kind, 'folder')
    assert.equal(consumed.path, 'apps/explorer/src')
    assert.equal(readExplain(env.dataDir).pendingStart, null)
    assert.equal(readExplain(env.dataDir).active, true)
    assert.equal(consumeExplainStart(env.dataDir), null)

    const fn = requestExplainTarget(env.dataDir, {
      kind: 'function',
      path: 'apps/explorer/src/explain.ts',
      name: 'explainTargetQuestion',
    })
    assert.equal(fn.pendingStart.kind, 'function')
    assert.equal(fn.pendingStart.name, 'explainTargetQuestion')
    assert.match(fn.question, /function explainTargetQuestion in apps\/explorer\/src\/explain\.ts/)
  } finally {
    env.cleanup()
  }
})

test('question-mark explain reports stay on the card', () => {
  const env = fixture()
  try {
    requestExplainTarget(env.dataDir, {
      kind: 'file',
      path: 'apps/explorer/src/App.tsx',
    })
    consumeExplainStart(env.dataDir)
    const started = startExplain(
      env.dataDir,
      explainTargetQuestion('file', 'apps/explorer/src/App.tsx'),
    )
    assert.equal(started.presentation, 'card')
    const reported = reportExplain(env.dataDir, {
      question: started.question,
      steps: [{ title: 'App owns the map', body: 'It renders World.' }],
    })
    assert.equal(reported.presentation, 'card')
    assert.equal(reported.steps.length, 1)
    assert.equal(reported.steps[0].body, 'It renders World.')
    const walk = startExplain(env.dataDir, 'Explain the current proposal: Bump value')
    assert.equal(walk.presentation, 'walk')
  } finally {
    env.cleanup()
  }
})

test('requestExplainTarget requires a file or folder path', () => {
  const env = fixture()
  try {
    assert.throws(
      () => requestExplainTarget(env.dataDir, { kind: 'file', path: '  ' }),
      /path is required/,
    )
    assert.throws(
      () => requestExplainTarget(env.dataDir, { kind: 'island', path: 'src' }),
      /kind must be file, folder, function, variable, or class/,
    )
    assert.throws(
      () =>
        requestExplainTarget(env.dataDir, {
          kind: 'function',
          path: 'apps/explorer/src/explain.ts',
        }),
      /name is required/,
    )
  } finally {
    env.cleanup()
  }
})

test('startExplain requires a question', () => {
  const env = fixture()
  try {
    assert.throws(() => startExplain(env.dataDir, '  '), /question is required/)
  } finally {
    env.cleanup()
  }
})

test('reportExplain --parent inserts dotted sub-steps after that step', () => {
  const env = fixture()
  try {
    startExplain(env.dataDir, 'How does the map work?')
    reportExplain(env.dataDir, {
      question: 'How does the map work?',
      steps: [
        { title: 'Root' },
        { title: 'CLI' },
        { title: 'Apps' },
        { title: 'Example' },
        { title: 'Explorer' },
        { title: 'Scripts' },
        { title: 'React app' },
        { title: 'Scene' },
      ],
    })
    const asked = askExplainQuestion(
      env.dataDir,
      '7',
      'What does App.tsx own?',
    )
    assert.equal(asked.pendingQuestion.parent, '7')
    assert.equal(asked.answering, false)

    const consumed = consumeExplainQuestion(env.dataDir)
    assert.equal(consumed.parent, '7')
    assert.equal(readExplain(env.dataDir).answering, true)
    assert.equal(readExplain(env.dataDir).pendingQuestion.parent, '7')

    const next = reportExplain(env.dataDir, {
      parent: '7',
      question: 'What does App.tsx own?',
      steps: [
        { title: 'App owns explain state', files: ['apps/explorer/src/App.tsx'] },
        { title: 'ExplainHud lists steps' },
        { title: 'World flies the camera' },
      ],
    })
    assert.deepEqual(
      next.steps.map((step) => step.index),
      ['1', '2', '3', '4', '5', '6', '7', '7.1', '7.2', '7.3', '8'],
    )
    assert.equal(next.currentStep, '7.1')
    assert.equal(next.steps[6].asked, 'What does App.tsx own?')
    assert.equal(next.pendingQuestion, null)
    assert.equal(next.answering, false)
    assert.equal(next.question, 'How does the map work?')
  } finally {
    env.cleanup()
  }
})

test('a new question on the same step replaces earlier sub-steps', () => {
  const env = fixture()
  try {
    startExplain(env.dataDir, 'Folders')
    reportExplain(env.dataDir, {
      steps: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }],
    })
    reportExplain(env.dataDir, {
      parent: '2',
      question: 'First look',
      steps: [{ title: 'Old A' }, { title: 'Old B' }],
    })
    const replaced = reportExplain(env.dataDir, {
      parent: '2',
      question: 'Second look',
      steps: [{ title: 'New A' }],
    })
    assert.deepEqual(
      replaced.steps.map((step) => `${step.index}:${step.title}`),
      ['1:One', '2:Two', '2.1:New A', '3:Three'],
    )
    assert.equal(replaced.steps[1].asked, 'Second look')
  } finally {
    env.cleanup()
  }
})

test('asking about a sub-step replaces the current sub-steps one level down', () => {
  const env = fixture()
  try {
    startExplain(env.dataDir, 'Folders')
    reportExplain(env.dataDir, {
      steps: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }],
    })
    reportExplain(env.dataDir, {
      parent: '2',
      question: 'Closer',
      steps: [{ title: 'Two first' }, { title: 'Two second' }],
    })
    const asked = askExplainQuestion(env.dataDir, '2.2', 'Even closer')
    assert.deepEqual(
      asked.steps.map((step) => step.index),
      ['1', '2', '3'],
    )
    assert.equal(asked.currentStep, '2')
    assert.equal(asked.pendingQuestion.parent, '2')
    assert.equal(asked.pendingQuestion.from, '2.2')
    assert.equal(asked.steps[1].asked, '')

    const replaced = reportExplain(env.dataDir, {
      parent: '2.2',
      question: 'Even closer',
      steps: [{ title: 'Detail' }, { title: 'More detail' }],
    })
    assert.deepEqual(
      replaced.steps.map((step) => `${step.index}:${step.title}`),
      ['1:One', '2:Two', '2.1:Detail', '2.2:More detail', '3:Three'],
    )
    assert.equal(replaced.currentStep, '2.1')
    assert.equal(replaced.steps[1].asked, 'Even closer')
  } finally {
    env.cleanup()
  }
})

test('a new sub-question on another step removes the previous sub-steps', () => {
  const env = fixture()
  try {
    startExplain(env.dataDir, 'Folders')
    reportExplain(env.dataDir, {
      steps: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }],
    })
    reportExplain(env.dataDir, {
      parent: '2',
      question: 'About two',
      steps: [{ title: 'Two first' }, { title: 'Two second' }],
    })
    const next = reportExplain(env.dataDir, {
      parent: '3',
      question: 'About three',
      steps: [{ title: 'Three first' }],
    })
    assert.deepEqual(
      next.steps.map((step) => `${step.index}:${step.title}`),
      ['1:One', '2:Two', '3:Three', '3.1:Three first'],
    )
    assert.equal(next.steps[1].asked, '')
    assert.equal(next.steps[2].asked, 'About three')
  } finally {
    env.cleanup()
  }
})

test('normalizeExplain keeps dotted ids from older numeric indexes', () => {
  const env = fixture()
  try {
    fs.writeFileSync(
      path.join(env.dataDir, 'explain.json'),
      JSON.stringify({
        active: true,
        question: 'Old',
        currentStep: 2,
        steps: [{ title: 'A' }, { title: 'B' }, { title: 'C' }],
      }),
    )
    const loaded = readExplain(env.dataDir)
    assert.equal(loaded.currentStep, '2')
    assert.deepEqual(
      loaded.steps.map((step) => step.index),
      ['1', '2', '3'],
    )
    assert.equal(loaded.pendingQuestion, null)
    assert.equal(loaded.answering, false)
  } finally {
    env.cleanup()
  }
})

test('mergeExplainPoll keeps the local step while the user navigates', () => {
  const reported = {
    active: true,
    question: 'How does login work?',
    presentation: 'walk',
    steps: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }],
    currentStep: '1',
    pendingQuestion: null,
    pendingStart: null,
    answering: false,
  }
  const onTwo = { ...reported, currentStep: '2' }
  const stale = mergeExplainPoll(onTwo, reported)
  assert.equal(stale.currentStep, '2')
  assert.equal(stale.steps.length, 3)

  const firstReport = mergeExplainPoll(
    { ...reported, steps: [], currentStep: '1' },
    reported,
  )
  assert.equal(firstReport.currentStep, '1')
  assert.equal(firstReport.steps.length, 3)

  const followUp = mergeExplainPoll(onTwo, {
    ...reported,
    currentStep: '2.1',
    steps: [
      { index: '1', title: 'One' },
      { index: '2', title: 'Two' },
      { index: '2.1', title: 'Closer' },
      { index: '3', title: 'Three' },
    ],
  })
  assert.equal(followUp.currentStep, '2.1')

  const asked = mergeExplainPoll(
    {
      ...onTwo,
      pendingQuestion: {
        parent: '2',
        question: 'Why this file?',
        from: '2',
        fromTitle: 'Two',
      },
    },
    reported,
  )
  assert.equal(asked.currentStep, '2')
  assert.equal(asked.pendingQuestion?.question, 'Why this file?')
})
