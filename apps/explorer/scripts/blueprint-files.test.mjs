import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  applyBlueprintDocument,
  BLUEPRINTS_DIR_NAME,
  blueprintFileName,
  defaultBlueprintsDir,
  listSavedBlueprints,
  loadBlueprintDocument,
  parseBlueprintDocument,
  resolveBlueprintSavePath,
  saveBlueprintDocument,
} from './blueprint-files.mjs'
import {
  ensureSessionPool,
  readBlueprint,
  readBlueprintByColor,
  updateBlueprint,
} from './session-store.mjs'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbase-blueprints-'))
  const dataDir = path.join(root, 'data')
  const targetRoot = path.join(root, 'target')
  fs.mkdirSync(targetRoot, { recursive: true })
  return {
    root,
    dataDir,
    targetRoot,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}

const globalFile = {
  id: 'src/Global.tsx',
  name: 'Global.tsx',
  path: 'src/Global.tsx',
  folder: 'src',
}

const coralFile = {
  id: 'src/Coral.tsx',
  name: 'Coral.tsx',
  path: 'src/Coral.tsx',
  folder: 'src',
}

const globalFolder = {
  id: 'src/widgets',
  name: 'widgets',
  path: 'src/widgets',
  parent: 'src',
}

test('names blueprint files after the given title', () => {
  assert.equal(blueprintFileName('Login page'), 'Login page.json')
  assert.equal(blueprintFileName('login-page.json'), 'login-page.json')
  assert.throws(() => blueprintFileName('   '), /name is required/)
})

test('saves into a blueprints folder on the target root', () => {
  const env = fixture()
  try {
    const saved = saveBlueprintDocument(env.targetRoot, {
      name: 'Login page',
      global: { files: [globalFile] },
      locals: [{ color: 'coral', files: [coralFile] }],
    })
    const expected = path.join(
      env.targetRoot,
      BLUEPRINTS_DIR_NAME,
      'Login page.json',
    )
    assert.equal(saved.path, expected)
    assert.equal(saved.relativePath, `${BLUEPRINTS_DIR_NAME}/Login page.json`)
    assert.equal(fs.existsSync(expected), true)
    const listed = listSavedBlueprints(env.targetRoot)
    assert.equal(listed.directory, defaultBlueprintsDir(env.targetRoot))
    assert.equal(listed.items.length, 1)
    assert.equal(listed.items[0].name, 'Login page')
  } finally {
    env.cleanup()
  }
})

test('saved documents use files and folders without positions', () => {
  const env = fixture()
  try {
    const saved = saveBlueprintDocument(env.targetRoot, {
      name: 'layout',
      global: {
        files: [{ ...globalFile, x: 12, z: 34 }],
        folders: [globalFolder],
      },
    })
    const document = JSON.parse(fs.readFileSync(saved.path, 'utf8'))
    assert.equal(document.kind, 'inbase-blueprint')
    assert.deepEqual(document.global.files, [globalFile])
    assert.deepEqual(document.global.folders, [globalFolder])
    assert.equal(document.global.userCreatedBlocks, undefined)
    assert.equal(document.global.userCreatedIslands, undefined)
    assert.equal('x' in document.global.files[0], false)
    assert.equal('z' in document.global.files[0], false)
  } finally {
    env.cleanup()
  }
})

test('save as writes to another folder', () => {
  const env = fixture()
  try {
    const elsewhere = path.join(env.root, 'exports')
    const saved = saveBlueprintDocument(env.targetRoot, {
      name: 'auth',
      directory: elsewhere,
      global: { files: [globalFile] },
    })
    assert.equal(saved.path, path.join(elsewhere, 'auth.json'))
    assert.equal(fs.existsSync(saved.path), true)
    assert.equal(
      listSavedBlueprints(env.targetRoot).items.length,
      0,
    )
  } finally {
    env.cleanup()
  }
})

test('load restores global and session-colored layers', () => {
  const env = fixture()
  try {
    ensureSessionPool(env.dataDir)
    updateBlueprint(env.dataDir, null, { files: [globalFile] })
    updateBlueprint(env.dataDir, null, {
      color: 'coral',
      files: [coralFile],
    })
    saveBlueprintDocument(env.targetRoot, {
      name: 'feature',
      global: readBlueprint(env.dataDir),
      locals: [
        {
          color: 'coral',
          files: [coralFile],
        },
      ],
    })
    updateBlueprint(env.dataDir, null, { files: [] })
    updateBlueprint(env.dataDir, null, {
      color: 'coral',
      files: [],
    })
    const loaded = loadBlueprintDocument(env.targetRoot, env.dataDir, {
      name: 'feature',
    })
    assert.deepEqual(loaded.global.files, [globalFile])
    assert.deepEqual(readBlueprintByColor(env.dataDir, 'coral').files, [
      coralFile,
    ])
  } finally {
    env.cleanup()
  }
})

test('load restores notes and pointers', () => {
  const env = fixture()
  try {
    ensureSessionPool(env.dataDir)
    const globalNotes = [
      {
        file: 'src/Global.tsx',
        kind: 'file',
        note: 'Keep this file presentational.',
      },
      {
        file: 'src/Global.tsx',
        kind: 'function',
        name: 'Clock',
        note: 'Render the current time.',
      },
    ]
    const coralNotes = [
      {
        file: 'src/Coral.tsx',
        kind: 'file',
        note: 'Session-only widget.',
      },
    ]
    const globalPointers = [{ kind: 'file', path: 'src/a.ts' }]
    saveBlueprintDocument(env.targetRoot, {
      name: 'noted',
      global: {
        files: [globalFile],
        addedFunctions: [{ name: 'Clock', file: 'src/Global.tsx' }],
        notes: globalNotes,
        pointers: globalPointers,
      },
      locals: [
        {
          color: 'coral',
          files: [coralFile],
          notes: coralNotes,
        },
      ],
    })
    const loaded = loadBlueprintDocument(env.targetRoot, env.dataDir, {
      name: 'noted',
    })
    assert.deepEqual(loaded.global.notes, globalNotes)
    assert.deepEqual(loaded.global.pointers, globalPointers)
    assert.deepEqual(loaded.global.addedFunctions, [
      { name: 'Clock', file: 'src/Global.tsx' },
    ])
    assert.deepEqual(readBlueprintByColor(env.dataDir, 'coral').notes, coralNotes)
    const document = JSON.parse(
      fs.readFileSync(
        path.join(env.targetRoot, BLUEPRINTS_DIR_NAME, 'noted.json'),
        'utf8',
      ),
    )
    assert.deepEqual(document.global.notes, globalNotes)
  } finally {
    env.cleanup()
  }
})

test('save keeps notes even when those files are not on disk', () => {
  const env = fixture()
  try {
    const notes = [
      {
        file: 'src/Missing.tsx',
        kind: 'file',
        note: 'Only apply this if the file is there later.',
      },
    ]
    const saved = saveBlueprintDocument(env.targetRoot, {
      name: 'saved-notes',
      global: { notes },
    })
    const document = JSON.parse(fs.readFileSync(saved.path, 'utf8'))
    assert.deepEqual(document.global.notes, notes)
  } finally {
    env.cleanup()
  }
})

test('apply keeps notes for blueprint files and existing files', () => {
  const env = fixture()
  try {
    ensureSessionPool(env.dataDir)
    fs.mkdirSync(path.join(env.targetRoot, 'src'), { recursive: true })
    fs.writeFileSync(path.join(env.targetRoot, 'src', 'Live.tsx'), 'export {}\n')
    saveBlueprintDocument(env.targetRoot, {
      name: 'best-effort-notes',
      global: {
        files: [globalFile],
        notes: [
          {
            file: 'src/Global.tsx',
            kind: 'file',
            note: 'Planned file note.',
          },
          {
            file: 'src/Live.tsx',
            kind: 'file',
            note: 'Existing file note.',
          },
          {
            file: 'src/Missing.tsx',
            kind: 'file',
            note: 'Gone.',
          },
        ],
      },
      locals: [
        {
          color: 'coral',
          notes: [
            {
              file: 'src/Live.tsx',
              kind: 'file',
              note: 'Session note on a live file.',
            },
            {
              file: 'src/Absent.tsx',
              kind: 'file',
              note: 'Skip this.',
            },
          ],
        },
      ],
    })
    const loaded = loadBlueprintDocument(env.targetRoot, env.dataDir, {
      name: 'best-effort-notes',
    })
    assert.deepEqual(loaded.global.notes, [
      {
        file: 'src/Global.tsx',
        kind: 'file',
        note: 'Planned file note.',
      },
      {
        file: 'src/Live.tsx',
        kind: 'file',
        note: 'Existing file note.',
      },
    ])
    assert.deepEqual(readBlueprintByColor(env.dataDir, 'coral').notes, [
      {
        file: 'src/Live.tsx',
        kind: 'file',
        note: 'Session note on a live file.',
      },
    ])
  } finally {
    env.cleanup()
  }
})

test('apply keeps folder notes for blueprint folders and existing folders', () => {
  const env = fixture()
  try {
    ensureSessionPool(env.dataDir)
    fs.mkdirSync(path.join(env.targetRoot, 'src'), { recursive: true })
    saveBlueprintDocument(env.targetRoot, {
      name: 'folder-notes',
      global: {
        folders: [globalFolder],
        notes: [
          {
            file: 'src/widgets',
            kind: 'folder',
            note: 'Planned folder note.',
          },
          {
            file: 'src',
            kind: 'folder',
            note: 'Existing folder note.',
          },
          {
            file: 'src/missing',
            kind: 'folder',
            note: 'Gone.',
          },
        ],
      },
    })
    const loaded = loadBlueprintDocument(env.targetRoot, env.dataDir, {
      name: 'folder-notes',
    })
    assert.deepEqual(loaded.global.notes, [
      {
        file: 'src/widgets',
        kind: 'folder',
        note: 'Planned folder note.',
      },
      {
        file: 'src',
        kind: 'folder',
        note: 'Existing folder note.',
      },
    ])
  } finally {
    env.cleanup()
  }
})

test('load treats a note without kind as a file note', () => {
  const env = fixture()
  try {
    ensureSessionPool(env.dataDir)
    saveBlueprintDocument(env.targetRoot, {
      name: 'legacy-note',
      global: {
        files: [globalFile],
        notes: [{ file: 'src/Global.tsx', note: 'Presentational.' }],
      },
    })
    const loaded = loadBlueprintDocument(env.targetRoot, env.dataDir, {
      name: 'legacy-note',
    })
    assert.deepEqual(loaded.global.notes, [
      {
        file: 'src/Global.tsx',
        kind: 'file',
        note: 'Presentational.',
      },
    ])
  } finally {
    env.cleanup()
  }
})

test('reads legacy block and island keys', () => {
  const parsed = parseBlueprintDocument({
    kind: 'inbase-blueprint',
    name: 'legacy',
    global: {
      userCreatedBlocks: [{ ...globalFile, x: 9, z: 8 }],
      userCreatedIslands: [globalFolder],
    },
  })
  assert.deepEqual(parsed.global.files, [globalFile])
  assert.deepEqual(parsed.global.folders, [globalFolder])
})

test('applying a document clears colors that were not saved', () => {
  const env = fixture()
  try {
    ensureSessionPool(env.dataDir)
    updateBlueprint(env.dataDir, null, {
      color: 'coral',
      files: [coralFile],
    })
    applyBlueprintDocument(env.dataDir, {
      name: 'empty-local',
      global: { files: [globalFile] },
      locals: [],
    })
    assert.deepEqual(readBlueprint(env.dataDir).files, [globalFile])
    assert.deepEqual(readBlueprintByColor(env.dataDir, 'coral').files, [])
  } finally {
    env.cleanup()
  }
})

test('rejects files that are not blueprints', () => {
  assert.throws(() => parseBlueprintDocument({ kind: 'other' }), /Not a blueprint/)
  const env = fixture()
  try {
    const filePath = resolveBlueprintSavePath(env.targetRoot, { name: 'nope' })
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, '{"hello":true}\n')
    assert.equal(listSavedBlueprints(env.targetRoot).items.length, 0)
  } finally {
    env.cleanup()
  }
})
