import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  compactInventory,
  fileEntryFromPath,
  folderEntryFromPath,
  normalizeExtractLayer,
  writeExtractedBlueprint,
  extractBlueprint,
} from './extract-blueprint.mjs'
import { parseBlueprintDocument } from '../apps/explorer/scripts/blueprint-files.mjs'
import { SESSION_COLORS } from '../apps/explorer/scripts/session-store.mjs'
import { buildScanGraph } from '../apps/explorer/scripts/scan-target.mjs'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbase-extract-'))
  const src = path.join(root, 'src')
  const widgets = path.join(src, 'widgets')
  fs.mkdirSync(widgets, { recursive: true })
  fs.writeFileSync(
    path.join(src, 'App.tsx'),
    `import { theme } from './theme'\nexport function App() { return theme }\nfunction helper() {}\n`,
  )
  fs.writeFileSync(path.join(src, 'theme.ts'), `export const theme = { color: 'blue' }\n`)
  fs.writeFileSync(
    path.join(widgets, 'Clock.tsx'),
    `export function Clock() {}\nconst unused = 1\n`,
  )
  fs.writeFileSync(
    path.join(src, 'App.test.tsx'),
    `import { App } from './App'\ntest('renders', () => App())\n`,
  )
  fs.mkdirSync(path.join(root, 'node_modules/pkg'), { recursive: true })
  fs.writeFileSync(path.join(root, 'node_modules/pkg/index.js'), 'export const skip = 1\n')
  return {
    root,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true })
    },
  }
}

async function capture(run) {
  let output = ''
  const log = console.log
  console.log = (message) => {
    output += `${message}\n`
  }
  try {
    return { result: await run(), output }
  } finally {
    console.log = log
  }
}

test('file and folder entries fill ids from paths', () => {
  assert.deepEqual(fileEntryFromPath('src/App.tsx'), {
    id: 'src/App.tsx',
    name: 'App.tsx',
    path: 'src/App.tsx',
    folder: 'src',
  })
  assert.deepEqual(folderEntryFromPath('src/widgets'), {
    id: 'src/widgets',
    name: 'widgets',
    path: 'src/widgets',
    parent: 'src',
  })
})

test('normalizeExtractLayer infers parent folders for kept files', () => {
  const layer = normalizeExtractLayer({
    files: [{ path: 'src/widgets/Clock.tsx' }],
    addedFunctions: [{ name: 'Clock', file: 'src/widgets/Clock.tsx' }],
    notes: [
      {
        file: 'src/widgets/Clock.tsx',
        kind: 'file',
        note: 'Displays the current time.',
      },
    ],
  })
  assert.deepEqual(
    layer.folders.map((folder) => folder.path),
    ['src', 'src/widgets'],
  )
  assert.equal(layer.files[0].name, 'Clock.tsx')
  assert.equal(layer.addedFunctions[0].name, 'Clock')
  assert.equal(layer.notes[0].kind, 'file')
})

test('compact inventory skips binaries and marks tests', () => {
  const env = fixture()
  try {
    const graph = buildScanGraph({ root: env.root, name: 'demo' })
    const inventory = compactInventory(graph, env.root)
    const byPath = Object.fromEntries(inventory.files.map((file) => [file.path, file]))
    assert.ok(byPath['src/App.tsx'])
    assert.deepEqual(byPath['src/App.tsx'].functions, ['App', 'helper'])
    assert.equal(byPath['src/App.test.tsx'].role, 'test')
    assert.equal(byPath['src/theme.ts'].role, 'source')
    assert.equal(
      inventory.files.some((file) => file.path.includes('node_modules')),
      false,
    )
  } finally {
    env.cleanup()
  }
})

test('extract-blueprint prints inventory and instruction without writing', async () => {
  const env = fixture()
  try {
    const outputPath = path.join(env.root, 'blueprints', 'demo.json')
    const { result, output } = await capture(() =>
      extractBlueprint(['src', 'blueprints/demo.json'], {
        cwd: env.root,
        targetRoot: env.root,
      }),
    )
    assert.match(output, /VISUAL_CODER_EXTRACT_INVENTORY_START/)
    assert.match(output, /VISUAL_CODER_EXTRACT_INSTRUCTION_START/)
    assert.match(output, /do not copy everything/)
    assert.match(output, /Extract a valuable Inbase blueprint/)
    assert.equal(fs.existsSync(outputPath), false)
    assert.ok(result.files.some((file) => file.path === 'App.tsx'))
  } finally {
    env.cleanup()
  }
})

test('extract-blueprint --write saves a curated document', async () => {
  const env = fixture()
  try {
    const layerPath = path.join(env.root, 'layer.json')
    fs.writeFileSync(
      layerPath,
      JSON.stringify({
        files: [{ path: 'App.tsx' }],
        addedFunctions: [{ name: 'App', file: 'App.tsx' }],
        notes: [
          {
            file: 'App.tsx',
            kind: 'file',
            note: 'Root UI. Keep data fetching out of this file.',
          },
        ],
      }),
    )
    const { output } = await capture(() =>
      extractBlueprint(
        ['src', 'blueprints/demo.json', '--write', layerPath],
        { cwd: env.root, targetRoot: env.root },
      ),
    )
    const savedPath = path.join(env.root, 'blueprints', 'demo.json')
    assert.match(output, /VISUAL_CODER_EXTRACT_SAVED/)
    assert.equal(fs.existsSync(savedPath), true)
    const document = parseBlueprintDocument(JSON.parse(fs.readFileSync(savedPath, 'utf8')))
    assert.equal(document.name, 'demo')
    assert.deepEqual(document.global.files, [
      { id: 'App.tsx', name: 'App.tsx', path: 'App.tsx', folder: '.' },
    ])
    assert.equal(document.global.addedFunctions[0].name, 'App')
    assert.equal(document.global.notes[0].note.includes('data fetching'), true)
    assert.equal(document.locals.length, SESSION_COLORS.length)
  } finally {
    env.cleanup()
  }
})

test('writeExtractedBlueprint keeps only curated symbols', async () => {
  const env = fixture()
  try {
    const saved = await writeExtractedBlueprint({
      targetRoot: env.root,
      outputPath: path.join(env.root, 'out.json'),
      name: 'slice',
      layer: {
        files: ['src/theme.ts'],
        addedVariables: [{ name: 'theme', file: 'src/theme.ts' }],
      },
    })
    const document = parseBlueprintDocument(JSON.parse(fs.readFileSync(saved.path, 'utf8')))
    assert.equal(document.global.files.length, 1)
    assert.equal(document.global.addedFunctions.length, 0)
    assert.deepEqual(document.global.addedVariables, [
      { name: 'theme', file: 'src/theme.ts' },
    ])
    assert.deepEqual(document.global.folders, [
      { id: 'src', name: 'src', path: 'src', parent: '.' },
    ])
  } finally {
    env.cleanup()
  }
})

test('cli extract-blueprint writes from stdin', () => {
  const env = fixture()
  try {
    const layer = JSON.stringify({
      files: [{ path: 'src/theme.ts' }],
      addedVariables: [{ name: 'theme', file: 'src/theme.ts' }],
    })
    const result = spawnSync(
      process.execPath,
      [
        path.join(packageRoot, 'bin/inbase.mjs'),
        'extract-blueprint',
        env.root,
        'blueprints/from-cli.json',
        '--write',
      ],
      {
        cwd: env.root,
        encoding: 'utf8',
        input: layer,
        env: { ...process.env, VISUAL_CODER_TARGET: env.root },
      },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /VISUAL_CODER_EXTRACT_SAVED/)
    assert.equal(fs.existsSync(path.join(env.root, 'blueprints/from-cli.json')), true)
  } finally {
    env.cleanup()
  }
})
