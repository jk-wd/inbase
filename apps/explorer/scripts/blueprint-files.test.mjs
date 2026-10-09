import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  applyBlueprintDocument,
  BLUEPRINTS_DIR_NAME,
  blueprintSetName,
  blueprintSubjectSlug,
  defaultBlueprintsDir,
  nextNumberedBlueprintSet,
  listSavedBlueprints,
  loadBlueprintDocument,
  parseBlueprintDocument,
  parseBlueprintDocuments,
  readBlueprintSetFromPath,
  resolveBlueprintSetFolder,
  saveBlueprintDocument,
} from './blueprint-files.mjs'
import {
  ensureSessionPool,
  readBlueprintByColor,
  updateBlueprint,
} from './session-store.mjs'

test('numbered blueprint sets use subject-num and skip taken numbers', () => {
  const env = fixture()
  try {
    assert.equal(blueprintSubjectSlug('Timer App!'), 'timer-app')
    const first = nextNumberedBlueprintSet(env.targetRoot, 'Timer App!')
    assert.deepEqual(first, {
      subject: 'timer-app',
      number: 1,
      name: 'timer-app-1',
      folderPath: 'blueprints/timer-app-1',
    })
    const dir = path.join(env.targetRoot, 'blueprints')
    fs.mkdirSync(path.join(dir, 'timer-app-1'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'timer-app-4'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'timer-app-6.json'), '{}')
    fs.mkdirSync(path.join(dir, 'other-9'), { recursive: true })
    const next = nextNumberedBlueprintSet(env.targetRoot, 'timer-app')
    assert.equal(next.name, 'timer-app-7')
    assert.equal(next.number, 7)
  } finally {
    env.cleanup()
  }
})

function blueBlueprint(set) {
  return set.blueprints.find((item) => item.color === 'blue')
}

function readSet(saved) {
  return readBlueprintSetFromPath(saved.path).set
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

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

test('names blueprint sets after the given title', () => {
  assert.equal(blueprintSetName('Login page'), 'Login page')
  assert.equal(blueprintSetName('login-page.json'), 'login-page')
  assert.equal(blueprintSetName('login-page-wrapper.json'), 'login-page')
  assert.equal(blueprintSetName('login-page.blueprint.json'), 'login-page')
  assert.throws(() => blueprintSetName('   '), /name is required/)
})

test('saves a set folder with a wrapper and one blueprint file per color', () => {
  const env = fixture()
  try {
    const saved = saveBlueprintDocument(env.targetRoot, {
      name: 'Login page',
      global: { files: [globalFile] },
      locals: [{ color: 'coral', files: [coralFile] }],
    })
    const folder = path.join(env.targetRoot, BLUEPRINTS_DIR_NAME, 'Login page')
    assert.equal(saved.path, path.join(folder, 'Login page-wrapper.json'))
    assert.equal(saved.relativePath, `${BLUEPRINTS_DIR_NAME}/Login page/Login page-wrapper.json`)
    assert.equal(saved.folder, `${BLUEPRINTS_DIR_NAME}/Login page`)
    assert.deepEqual(fs.readdirSync(folder).sort(), [
      'Login page-blue.blueprint.json',
      'Login page-coral.blueprint.json',
      'Login page-wrapper.json',
    ])
    const wrapper = readJson(saved.path)
    assert.equal(wrapper.kind, 'inbase-wrapper')
    assert.deepEqual(wrapper.blueprints, [
      { color: 'blue', file: 'Login page-blue.blueprint.json', hidden: false, dependsOn: [] },
      { color: 'coral', file: 'Login page-coral.blueprint.json', hidden: false, dependsOn: [] },
    ])
    const coral = readJson(path.join(folder, 'Login page-coral.blueprint.json'))
    assert.equal(coral.kind, 'blueprint')
    assert.equal(coral.name, 'Login page-coral')
    assert.deepEqual(coral.files, [coralFile])
    for (const key of ['color', 'colorName', 'colorHex', 'hidden', 'dependsOn']) {
      assert.equal(key in coral, false, key)
    }
    const listed = listSavedBlueprints(env.targetRoot)
    assert.equal(listed.directory, defaultBlueprintsDir(env.targetRoot))
    assert.equal(listed.items.length, 1)
    assert.equal(listed.items[0].name, 'Login page')
    assert.equal(listed.items[0].fileName, 'Login page-wrapper.json')
  } finally {
    env.cleanup()
  }
})

test('a set with one blueprint has no color in the file name', () => {
  const env = fixture()
  try {
    const saved = saveBlueprintDocument(env.targetRoot, {
      name: 'solo',
      blueprints: [{ color: 'amber', files: [globalFile] }],
    })
    assert.deepEqual(saved.blueprintFiles.map((file) => file.relativePath), [
      'blueprints/solo/solo.blueprint.json',
    ])
    assert.equal(readJson(saved.path).blueprints[0].color, 'amber')
  } finally {
    env.cleanup()
  }
})

test('saving again removes blueprint files the set no longer uses', () => {
  const env = fixture()
  try {
    saveBlueprintDocument(env.targetRoot, {
      name: 'grow',
      blueprints: [{ color: 'blue', files: [globalFile] }],
    })
    const folder = path.join(env.targetRoot, BLUEPRINTS_DIR_NAME, 'grow')
    fs.writeFileSync(path.join(folder, 'README.md'), 'keep me\n')
    const saved = saveBlueprintDocument(env.targetRoot, {
      name: 'grow',
      filePath: path.join(folder, 'grow-wrapper.json'),
      blueprints: [
        { color: 'blue', files: [globalFile] },
        { color: 'coral', files: [coralFile] },
      ],
    })
    assert.deepEqual(fs.readdirSync(folder).sort(), [
      'README.md',
      'grow-blue.blueprint.json',
      'grow-coral.blueprint.json',
      'grow-wrapper.json',
    ])
    saveBlueprintDocument(env.targetRoot, {
      name: 'grow',
      filePath: saved.path,
      blueprints: [{ color: 'coral', files: [coralFile] }],
    })
    assert.deepEqual(fs.readdirSync(folder).sort(), [
      'README.md',
      'grow-wrapper.json',
      'grow.blueprint.json',
    ])
  } finally {
    env.cleanup()
  }
})

test('saved blueprints use files and folders without positions', () => {
  const env = fixture()
  try {
    const saved = saveBlueprintDocument(env.targetRoot, {
      name: 'layout',
      global: {
        files: [{ ...globalFile, x: 12, z: 34 }],
        folders: [globalFolder],
      },
    })
    const document = readJson(saved.blueprintFiles[0].path)
    assert.equal(document.kind, 'blueprint')
    assert.deepEqual(document.files, [globalFile])
    assert.deepEqual(document.folders, [globalFolder])
    assert.equal(document.userCreatedBlocks, undefined)
    assert.equal(document.userCreatedIslands, undefined)
    assert.equal('x' in document.files[0], false)
    assert.equal('z' in document.files[0], false)
  } finally {
    env.cleanup()
  }
})

test('save as writes the set folder into another parent folder', () => {
  const env = fixture()
  try {
    const elsewhere = path.join(env.root, 'exports')
    const saved = saveBlueprintDocument(env.targetRoot, {
      name: 'auth',
      directory: elsewhere,
      global: { files: [globalFile] },
    })
    assert.equal(saved.path, path.join(elsewhere, 'auth', 'auth-wrapper.json'))
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
      global: readBlueprintByColor(env.dataDir, 'blue'),
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
        functions: [{ name: 'Clock', file: 'src/Global.tsx' }],
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
    assert.deepEqual(loaded.global.functions, [
      { name: 'Clock', file: 'src/Global.tsx' },
    ])
    assert.deepEqual(readBlueprintByColor(env.dataDir, 'coral').notes, coralNotes)
    const document = readJson(
      path.join(env.targetRoot, BLUEPRINTS_DIR_NAME, 'noted', 'noted-blue.blueprint.json'),
    )
    assert.deepEqual(document.notes, globalNotes)
  } finally {
    env.cleanup()
  }
})

test('save and load keep color depends-on relations in the wrapper', () => {
  const env = fixture()
  try {
    ensureSessionPool(env.dataDir)
    saveBlueprintDocument(env.targetRoot, {
      name: 'deps',
      global: { files: [globalFile] },
      locals: [
        {
          color: 'coral',
          files: [coralFile],
          dependsOn: ['blue'],
        },
        {
          color: 'crimson',
          dependsOn: ['blue', 'coral'],
        },
      ],
    })
    const loaded = loadBlueprintDocument(env.targetRoot, env.dataDir, {
      name: 'deps',
    })
    assert.deepEqual(loaded.global.dependsOn, [])
    assert.deepEqual(readBlueprintByColor(env.dataDir, 'coral').dependsOn, ['blue'])
    assert.deepEqual(readBlueprintByColor(env.dataDir, 'crimson').dependsOn, [
      'blue',
      'coral',
    ])
    const folder = path.join(env.targetRoot, BLUEPRINTS_DIR_NAME, 'deps')
    const wrapper = readJson(path.join(folder, 'deps-wrapper.json'))
    assert.deepEqual(blueBlueprint(wrapper).dependsOn, [])
    assert.deepEqual(
      wrapper.blueprints.find((item) => item.color === 'crimson').dependsOn,
      ['blue', 'coral'],
    )
    assert.equal('dependsOn' in readJson(path.join(folder, 'deps-crimson.blueprint.json')), false)
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
    assert.deepEqual(blueBlueprint(readSet(saved)).notes, notes)
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
  assert.deepEqual(blueBlueprint(parsed).files, [globalFile])
  assert.deepEqual(blueBlueprint(parsed).folders, [globalFolder])
})

test('wrappers list only colors with content and keep hidden', () => {
  const env = fixture()
  try {
    const saved = saveBlueprintDocument(env.targetRoot, {
      name: 'shape',
      blueprints: [
        { color: 'blue', files: [globalFile] },
        { color: 'coral', files: [coralFile], hidden: true },
        { color: 'amber', hidden: true },
      ],
    })
    const wrapper = readJson(saved.path)
    assert.equal('global' in wrapper, false)
    assert.equal('locals' in wrapper, false)
    assert.deepEqual(
      wrapper.blueprints.map((item) => [item.color, item.hidden]),
      [
        ['blue', false],
        ['coral', true],
      ],
    )
  } finally {
    env.cleanup()
  }
})

test('loads an older single-file document from the blueprints folder', () => {
  const env = fixture()
  try {
    ensureSessionPool(env.dataDir)
    const dir = path.join(env.targetRoot, BLUEPRINTS_DIR_NAME)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'old.json'),
      JSON.stringify({
        version: 1,
        kind: 'inbase-blueprint',
        name: 'old',
        savedAt: '2026-01-01T00:00:00.000Z',
        blueprints: [{ color: 'coral', files: [coralFile] }],
      }),
    )
    assert.deepEqual(
      listSavedBlueprints(env.targetRoot).items.map((item) => item.name),
      ['old'],
    )
    loadBlueprintDocument(env.targetRoot, env.dataDir, { name: 'old' })
    assert.deepEqual(readBlueprintByColor(env.dataDir, 'coral').files, [coralFile])
    const resaved = saveBlueprintDocument(env.targetRoot, {
      name: 'old',
      filePath: path.join(dir, 'old.json'),
      blueprints: [{ color: 'coral', files: [coralFile] }],
    })
    assert.equal(resaved.relativePath, 'blueprints/old/old-wrapper.json')
  } finally {
    env.cleanup()
  }
})

test('a single blueprint file loads into the first color', () => {
  const set = parseBlueprintDocument({
    version: 1,
    kind: 'inbase-blueprint',
    name: 'loose',
    files: [coralFile],
  })
  assert.equal(set.name, 'loose')
  assert.deepEqual(set.blueprints.map((item) => item.color), ['blue'])
  assert.deepEqual(blueBlueprint(set).files, [coralFile])
})

test('uploaded wrapper and blueprint files load together', () => {
  const env = fixture()
  try {
    const saved = saveBlueprintDocument(env.targetRoot, {
      name: 'upload',
      blueprints: [
        { color: 'blue', files: [globalFile] },
        { color: 'teal', files: [coralFile], dependsOn: ['blue'] },
      ],
    })
    const documents = [saved.path, ...saved.blueprintFiles.map((file) => file.path)].map(
      (filePath) => ({ fileName: path.basename(filePath), document: readJson(filePath) }),
    )
    const set = parseBlueprintDocuments(documents)
    assert.equal(set.name, 'upload')
    const teal = set.blueprints.find((item) => item.color === 'teal')
    assert.deepEqual(teal.files, [coralFile])
    assert.deepEqual(teal.dependsOn, ['blue'])

    assert.throws(
      () => parseBlueprintDocuments(documents.slice(0, 2)),
      /Blueprint file not found: upload-teal\.blueprint\.json/,
    )
    assert.throws(() => parseBlueprintDocument(documents[0].document), /wrapper file/)
  } finally {
    env.cleanup()
  }
})

test('loads legacy global and locals documents', () => {
  const env = fixture()
  try {
    ensureSessionPool(env.dataDir)
    const legacy = {
      version: 1,
      kind: 'inbase-blueprint',
      name: 'legacy-shape',
      global: { files: [globalFile] },
      locals: [{ color: 'coral', files: [coralFile] }],
    }
    const parsed = parseBlueprintDocument(legacy)
    assert.equal('global' in parsed, false)
    assert.deepEqual(blueBlueprint(parsed).files, [globalFile])
    const loaded = applyBlueprintDocument(env.dataDir, legacy)
    assert.deepEqual(loaded.global.files, [globalFile])
    assert.deepEqual(readBlueprintByColor(env.dataDir, 'coral').files, [coralFile])

    const withBlue = parseBlueprintDocument({
      ...legacy,
      locals: [{ color: 'blue', files: [coralFile] }],
    })
    assert.deepEqual(blueBlueprint(withBlue).files, [coralFile])
  } finally {
    env.cleanup()
  }
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
    assert.deepEqual(readBlueprintByColor(env.dataDir, 'blue').files, [globalFile])
    assert.deepEqual(readBlueprintByColor(env.dataDir, 'coral').files, [])
  } finally {
    env.cleanup()
  }
})

test('example-target ships four React app blueprints', () => {
  const targetRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../example-target',
  )
  const listed = listSavedBlueprints(targetRoot)
  assert.deepEqual(
    listed.items.map((item) => item.name).sort(),
    ['counter', 'pomodoro', 'sticky-notes', 'todo-app'],
  )
  const env = fixture()
  try {
    ensureSessionPool(env.dataDir)
    loadBlueprintDocument(targetRoot, env.dataDir, { name: 'todo-app' })
    const blue = readBlueprintByColor(env.dataDir, 'blue')
    assert.equal(blue.files.length, 13)
    assert.ok(blue.imports.length >= 20)
    assert.equal(blue.dependsOn.length, 0)
    assert.equal(readBlueprintByColor(env.dataDir, 'coral').files.length, 0)
    assert.ok(blue.files.every((item) => item.path.startsWith('src/todo/')))

    loadBlueprintDocument(targetRoot, env.dataDir, { name: 'sticky-notes' })
    const notes = readBlueprintByColor(env.dataDir, 'blue')
    assert.equal(notes.files.length, 13)
    assert.ok(notes.functions.some((item) => item.name === 'togglePin'))
    assert.ok(notes.functions.some((item) => item.name === 'visibleNotes'))
    assert.ok(notes.files.every((item) => item.path.startsWith('src/notes/')))
  } finally {
    env.cleanup()
  }
})

test('rejects files that are not blueprints', () => {
  assert.throws(() => parseBlueprintDocument({ kind: 'other' }), /Not a blueprint/)
  const env = fixture()
  try {
    const folder = resolveBlueprintSetFolder(env.targetRoot, { name: 'nope' })
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'nope-wrapper.json'), '{"hello":true}\n')
    fs.writeFileSync(path.join(path.dirname(folder), 'stray.json'), '{"hello":true}\n')
    assert.equal(listSavedBlueprints(env.targetRoot).items.length, 0)
  } finally {
    env.cleanup()
  }
})
