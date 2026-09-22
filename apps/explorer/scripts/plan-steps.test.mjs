import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compareStepIds,
  nextInvokedStepIds,
  parentStepIds,
  parseStepTitle,
  planLabeledSteps,
  readyStepIds,
  stepIdOf,
} from './plan-steps.mjs'

test('parseStepTitle reads lettered ids and leaves plain titles alone', () => {
  assert.deepEqual(parseStepTitle('2A. Add NoteCard'), {
    id: '2A',
    title: 'Add NoteCard',
  })
  assert.deepEqual(parseStepTitle('2B.1: Persist notes'), {
    id: '2B.1',
    title: 'Persist notes',
  })
  assert.deepEqual(parseStepTitle('Add types'), {
    id: null,
    title: 'Add types',
  })
})

test('planLabeledSteps auto-numbers plain titles', () => {
  const steps = planLabeledSteps(['Types', 'UI'], 1)
  assert.deepEqual(
    steps.map((step) => ({ index: step.index, id: step.id, title: step.title })),
    [
      { index: 1, id: '1', title: 'Types' },
      { index: 2, id: '2', title: 'UI' },
    ],
  )
})

test('planLabeledSteps keeps lettered parallel ids', () => {
  const steps = planLabeledSteps([
    '1. Shared types',
    '2A. Note card',
    '2B. Notes store',
    '2A.1. Color picker',
    '3. Wire App',
  ])
  assert.deepEqual(
    steps.map((step) => step.id),
    ['1', '2A', '2B', '2A.1', '3'],
  )
})

test('parent and ready steps follow lettered waves', () => {
  const steps = planLabeledSteps([
    '1. Types',
    '2A. Card',
    '2B. Store',
    '2A.1. Picker',
    '3. App',
  ])
  const ids = steps.map((step) => step.id)
  assert.deepEqual(parentStepIds('2A', ids), ['1'])
  assert.deepEqual(parentStepIds('2A.1', ids), ['2A'])
  assert.deepEqual(parentStepIds('3', ids).sort(compareStepIds), [
    '2A',
    '2A.1',
    '2B',
  ])
  assert.deepEqual(readyStepIds(steps, [], []), ['1'])
  assert.deepEqual(readyStepIds(steps, ['1'], []), ['2A', '2B'])
  assert.deepEqual(readyStepIds(steps, ['1', '2A'], ['2B']), ['2A.1'])
  assert.deepEqual(readyStepIds(steps, ['1', '2A', '2A.1', '2B'], []), ['3'])
})

test('maxSubagents caps how many lettered steps start at once', () => {
  const steps = planLabeledSteps(['2A. One', '2B. Two', '2C. Three'])
  assert.deepEqual(nextInvokedStepIds(steps, [], [], 2), ['2A', '2B'])
  assert.deepEqual(nextInvokedStepIds(steps, ['2A'], ['2B'], 2), ['2B', '2C'])
  assert.deepEqual(nextInvokedStepIds(steps, [], [], 0), ['2A'])
})

test('stepIdOf falls back to the numeric index', () => {
  assert.equal(stepIdOf({ index: 3, title: 'Later' }), '3')
  assert.equal(stepIdOf({ index: 3, id: '2A', title: 'Card' }), '2A')
})
