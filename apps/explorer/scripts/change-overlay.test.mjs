import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attachChangeNotes,
  formatLlmChangeLine,
  llmChangeNoteForPath,
  mergeChangeNotes,
  overlayPathChangeKind,
  parseChangeNoteFlags,
  synthesizeFileNote,
  synthesizeFolderNote,
} from './change-overlay.mjs'

const overlay = {
  files: ['bin/extract-blueprint.mjs'],
  creates: [],
  deletes: [],
  createFolders: [],
  changedFunctions: [
    { name: 'normalizeNote', file: 'bin/extract-blueprint.mjs' },
  ],
  addedFunctions: [],
  changedVariables: [{ name: 'note', file: 'bin/extract-blueprint.mjs' }],
  addedVariables: [],
}

test('parses --note path: summary flags', () => {
  assert.deepEqual(
    parseChangeNoteFlags([
      'bin/extract-blueprint.mjs: edited normalizeNote to also check for null',
      'bin: tightened note handling',
    ]),
    {
      'bin/extract-blueprint.mjs':
        'edited normalizeNote to also check for null',
      bin: 'tightened note handling',
    },
  )
  assert.deepEqual(parseChangeNoteFlags(['no-colon']), {})
})

test('synthesizes a scannable file note from symbols and the step goal', () => {
  assert.equal(
    synthesizeFileNote(overlay, 'bin/extract-blueprint.mjs', 'also check for null'),
    'edited normalizeNote — also check for null',
  )
  assert.equal(
    overlayPathChangeKind(overlay, 'bin/extract-blueprint.mjs'),
    'edit',
  )
  assert.equal(
    formatLlmChangeLine({
      kind: 'edit',
      colorName: 'Coral',
      note: 'edited normalizeNote to also check for null',
    }),
    'I changed: (Coral) edited normalizeNote to also check for null',
  )
})

test('folder notes roll up a single file note or count mixed changes', () => {
  assert.equal(
    llmChangeNoteForPath(
      {
        ...overlay,
        changeNotes: {
          'bin/extract-blueprint.mjs':
            'edited normalizeNote to also check for null',
        },
      },
      'bin',
      { folder: true, reason: 'also check for null' },
    ),
    'edited normalizeNote to also check for null',
  )
  assert.equal(
    synthesizeFolderNote(
      {
        files: ['src/a.ts', 'src/b.ts'],
        creates: ['src/c.ts'],
        deletes: [],
      },
      'src',
      'Clock on Home',
    ),
    'edited 2 files, added 1 — Clock on Home',
  )
  assert.equal(overlayPathChangeKind(overlay, 'bin', true), 'edit')
})

test('attaches LLM notes and keeps them on a later live overlay', () => {
  const stored = attachChangeNotes(overlay, {
    'bin/extract-blueprint.mjs':
      'edited normalizeNote to also check for null',
    ignored: 'stale',
  })
  assert.deepEqual(stored.changeNotes, {
    'bin/extract-blueprint.mjs':
      'edited normalizeNote to also check for null',
  })
  const live = mergeChangeNotes(
    {
      files: ['bin/extract-blueprint.mjs', 'bin/session.mjs'],
      creates: [],
      deletes: [],
    },
    stored,
  )
  assert.equal(
    live.changeNotes['bin/extract-blueprint.mjs'],
    'edited normalizeNote to also check for null',
  )
  assert.equal(live.changeNotes.ignored, undefined)
})
