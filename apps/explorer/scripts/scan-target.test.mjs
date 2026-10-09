import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  collectImportSpecifiers,
  extractImportBindings,
  extractJsSymbols,
  extractSymbols,
  resolveSpecifierAgainst,
} from './js-source.mjs'
import { relationAnalyzers } from './relations/index.mjs'
import { structureAnalyzers } from './structure/index.mjs'
import { shouldIgnoreRelativePath } from './scan-ignore.mjs'
import { scanTarget } from './scan-target.mjs'

function scanQuiet(options) {
  const log = console.log
  console.log = () => {}
  try {
    return scanTarget(options)
  } finally {
    console.log = log
  }
}

test('resolves specifiers to any known file, not only JS extensions', () => {
  const known = new Set(['src/Header.astro', 'src/lib/index.vue'])
  assert.equal(resolveSpecifierAgainst('src/Header.astro', known), 'src/Header.astro')
  assert.equal(resolveSpecifierAgainst('src/Header', known), 'src/Header.astro')
  assert.equal(resolveSpecifierAgainst('src/lib', known), 'src/lib/index.vue')
})

test('registers a JavaScript structure analyzer', () => {
  assert.deepEqual(
    structureAnalyzers.map((analyzer) => analyzer.id),
    ['javascript', 'csharp'],
  )
})

test('extracts classes alongside functions and variables', () => {
  const symbols = extractJsSymbols(`
    export class AppComponent {}
    export abstract class Base {}
    export default class DefaultView {}
    export function helper() {}
    export const value = 1
  `)
  assert.deepEqual(symbols, [
    { name: 'helper', kind: 'function' },
    { name: 'AppComponent', kind: 'class' },
    { name: 'Base', kind: 'class' },
    { name: 'DefaultView', kind: 'class' },
    { name: 'value', kind: 'variable' },
  ])
})

test('collects relative require() specifiers', () => {
  assert.deepEqual(
    collectImportSpecifiers(`
      const helper = require('./helper')
      require("./boot")
      import other from './other'
    `),
    ['./other', './helper', './boot'],
  )
})

test('registers ESM, require, and HTML relation analyzers', () => {
  assert.deepEqual(
    relationAnalyzers.map((analyzer) => analyzer.id),
    ['esm', 'require', 'html', 'csharp'],
  )
})

test('collects HTML script src specifiers only for HTML files', () => {
  const source = `
    <script type="module" src="./boot.js"></script>
    <script src="https://cdn.example.com/x.js"></script>
  `
  assert.deepEqual(collectImportSpecifiers(source, 'index.html'), [
    './boot.js',
    'https://cdn.example.com/x.js',
  ])
  assert.deepEqual(collectImportSpecifiers(source, 'app.ts'), [])
})

test('extracts CommonJS require bindings', () => {
  assert.deepEqual(
    extractImportBindings(`
      const helper = require('./helper')
      const { format } = require('./format')
      require('./side-effect')
    `),
    [
      { name: 'helper', from: './helper' },
      { name: 'format', from: './format' },
      { name: './side-effect', from: './side-effect' },
    ],
  )
})

test('extracts C# classes, methods, and fields', () => {
  const symbols = extractSymbols(
    `
      namespace TodoApp.Store;

      public class TodoStore : Store, IPersistable
      {
          private readonly List<string> items = new();
          public string Title { get; set; }
          public TodoStore() { }
          public void Add(string title) { items.Add(title); }
      }
    `,
    'TodoStore.cs',
  )
  assert.deepEqual(symbols, [
    { name: 'TodoStore', kind: 'class' },
    { name: 'items', kind: 'variable', class: 'TodoStore' },
    { name: 'Title', kind: 'variable', class: 'TodoStore' },
    { name: 'TodoStore', kind: 'function', class: 'TodoStore' },
    { name: 'Add', kind: 'function', class: 'TodoStore' },
  ])
})

test('collects C# using directives as import specifiers', () => {
  const source = `
    global using TodoApp.Models;
    using TodoApp.Store;
    using static TodoApp.Store.TodoStore;
    using Log = TodoApp.Log.Logger;
    using var reader = new StreamReader(path);
  `
  assert.deepEqual(collectImportSpecifiers(source, 'Page.cs'), [
    'TodoApp.Models',
    'TodoApp.Store',
    'TodoApp.Store.TodoStore',
    'TodoApp.Log.Logger',
  ])
  assert.deepEqual(collectImportSpecifiers(source, 'Page.ts'), [])
  assert.deepEqual(extractImportBindings(source, 'Page.cs'), [
    { name: 'Models', from: 'TodoApp.Models' },
    { name: 'Store', from: 'TodoApp.Store' },
    { name: 'TodoStore', from: 'TodoApp.Store.TodoStore' },
    { name: 'Logger', from: 'TodoApp.Log.Logger' },
  ])
})

test('links C# usings to local files that declare the namespace or type', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-coder-csharp-'))
  const dest = path.join(root, 'codebase.json')
  try {
    fs.mkdirSync(path.join(root, 'Store'))
    fs.writeFileSync(
      path.join(root, 'Store/TodoStore.cs'),
      'namespace TodoApp.Store;\npublic class TodoStore { public void Add(string title) {} }\n',
    )
    fs.writeFileSync(
      path.join(root, 'Page.cs'),
      'using TodoApp.Store;\nusing static TodoApp.Store.TodoStore;\nnamespace TodoApp.UI;\npublic class TodoPage { }\n',
    )
    fs.writeFileSync(
      path.join(root, 'Other.cs'),
      'namespace TodoApp.Other;\npublic class Other { }\n',
    )
    const graph = scanQuiet({ root, dest })
    const byId = Object.fromEntries(graph.files.map((file) => [file.id, file]))
    assert.deepEqual(byId['Page.cs'].imports, ['Store/TodoStore.cs'])
    assert.deepEqual(byId['Store/TodoStore.cs'].imports, [])
    assert.equal(
      byId['Store/TodoStore.cs'].symbols.some(
        (symbol) => symbol.kind === 'class' && symbol.name === 'TodoStore',
      ),
      true,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('scans the C# example app classes and usings', () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../example-csharp',
  )
  const dest = path.join(os.tmpdir(), `example-csharp-scan-${process.pid}.json`)
  try {
    const graph = scanQuiet({ root, dest })
    const byId = Object.fromEntries(graph.files.map((file) => [file.id, file]))
    const classNames = (id) =>
      byId[id].symbols.filter((symbol) => symbol.kind === 'class').map((symbol) => symbol.name)
    assert.deepEqual(classNames('src/Models/Todo.cs'), ['Todo'])
    assert.deepEqual(classNames('src/Store/TodoStore.cs').sort(), ['Store', 'TodoStore'])
    assert.deepEqual(classNames('src/Store/LoggingStore.cs'), ['LoggingStore'])
    assert.deepEqual(classNames('src/UI/TodoPage.cs'), ['TodoPage'])
    assert.deepEqual(classNames('src/Program.cs'), ['App'])
    assert.deepEqual(byId['src/Store/TodoStore.cs'].imports, ['src/Models/Todo.cs'])
    assert.deepEqual(byId['src/Store/LoggingStore.cs'].imports, ['src/Store/TodoStore.cs'])
    assert.deepEqual(byId['src/UI/TodoPage.cs'].imports.sort(), [
      'src/Store/LoggingStore.cs',
      'src/Store/TodoStore.cs',
    ])
    assert.ok(
      byId['src/Store/TodoStore.cs'].symbols.some(
        (symbol) => symbol.kind === 'function' && symbol.name === 'Add' && symbol.class === 'TodoStore',
      ),
    )
  } finally {
    fs.rmSync(dest, { force: true })
  }
})

test('scans text files, binaries, and hidden files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-coder-scan-'))
  const dest = path.join(root, 'codebase.json')
  try {
    fs.writeFileSync(
      path.join(root, 'app.ts'),
      'export class AppComponent {}\nexport function boot() {}\n',
    )
    fs.writeFileSync(path.join(root, 'helper.cjs'), 'module.exports = { ok: true }\n')
    fs.writeFileSync(
      path.join(root, 'server.cjs'),
      "const helper = require('./helper')\nmodule.exports = helper\n",
    )
    fs.writeFileSync(path.join(root, 'util.mjs'), 'export const n = 1\n')
    fs.writeFileSync(path.join(root, 'styles.scss'), 'body { color: black; }\n')
    fs.writeFileSync(path.join(root, 'notes.md'), '# Notes\n')
    fs.writeFileSync(path.join(root, 'script.py'), 'print("ok")\n')
    fs.writeFileSync(path.join(root, 'Dockerfile'), 'FROM node:22\n')
    fs.writeFileSync(
      path.join(root, 'Header.astro'),
      '---\nexport const title = "Hi"\n---\n<h1>{title}</h1>\n',
    )
    fs.writeFileSync(
      path.join(root, 'index.astro'),
      "---\nimport Header from './Header.astro'\n---\n<Header />\n",
    )
    fs.writeFileSync(
      path.join(root, 'page.astro'),
      "---\nimport Header from './Header'\n---\n<Header />\n",
    )
    fs.writeFileSync(path.join(root, 'boot.js'), "import logo from './logo.png'\nexport const boot = 1\n")
    fs.writeFileSync(
      path.join(root, 'index.html'),
      '<script type="module" src="./boot.js"></script>\n<script src="https://cdn.example.com/x.js"></script>\n',
    )
    fs.writeFileSync(path.join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]))
    fs.writeFileSync(path.join(root, 'photo.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]))
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n')
    fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true })
    fs.writeFileSync(path.join(root, '.github/workflows/ci.yml'), 'name: ci\n')
    fs.mkdirSync(path.join(root, '.inbase'), { recursive: true })
    fs.writeFileSync(path.join(root, '.inbase/cache.json'), '{}\n')

    const graph = scanQuiet({ root, dest })

    const byId = Object.fromEntries(graph.files.map((file) => [file.id, file]))
    assert.equal(graph.targetName, path.basename(root))
    assert.ok(byId['app.ts'])
    assert.ok(byId['helper.cjs'])
    assert.ok(byId['server.cjs'])
    assert.ok(byId['util.mjs'])
    assert.ok(byId['styles.scss'])
    assert.ok(byId['notes.md'])
    assert.ok(byId['script.py'])
    assert.ok(byId['Dockerfile'])
    assert.ok(byId['Header.astro'])
    assert.ok(byId['index.astro'])
    assert.ok(byId['page.astro'])
    assert.ok(byId['logo.png'])
    assert.equal(byId['logo.png'].binary, true)
    assert.deepEqual(byId['logo.png'].symbols, [])
    assert.deepEqual(byId['logo.png'].imports, [])
    assert.equal(byId['photo.bin'].binary, true)
    assert.ok(byId['.env'])
    assert.equal(byId['.env'].binary, undefined)
    assert.ok(byId['.github/workflows/ci.yml'])
    assert.equal(byId['.inbase/cache.json'], undefined)
    assert.deepEqual(byId['app.ts'].symbols, [
      { name: 'boot', kind: 'function' },
      { name: 'AppComponent', kind: 'class' },
    ])
    assert.deepEqual(byId['server.cjs'].imports, ['helper.cjs'])
    assert.deepEqual(byId['index.astro'].imports, ['Header.astro'])
    assert.deepEqual(byId['page.astro'].imports, ['Header.astro'])
    assert.deepEqual(byId['index.html'].imports, ['boot.js'])
    assert.deepEqual(byId['boot.js'].imports, ['logo.png'])
    assert.deepEqual(byId['styles.scss'].symbols, [])
    assert.deepEqual(byId['script.py'].symbols, [])
    assert.equal(byId['styles.scss'].language, 'scss')
    assert.equal(byId['Header.astro'].language, 'astro')
    assert.equal(byId['Dockerfile'].language, 'txt')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('ignores node_modules, dist, and lockfiles at any depth', () => {
  assert.equal(shouldIgnoreRelativePath('node_modules/three/index.js'), true)
  assert.equal(
    shouldIgnoreRelativePath('apps/web/node_modules/@react-three/fiber/index.js'),
    true,
  )
  assert.equal(shouldIgnoreRelativePath('packages/ui/dist/index.js'), true)
  assert.equal(shouldIgnoreRelativePath('apps/web/.next/server.js'), true)
  assert.equal(shouldIgnoreRelativePath('apps/web/package-lock.json'), true)
  assert.equal(shouldIgnoreRelativePath('apps/web/src/app.ts'), false)
  assert.equal(shouldIgnoreRelativePath('.env'), false)
  assert.equal(shouldIgnoreRelativePath('.github/workflows/ci.yml'), false)
  assert.equal(shouldIgnoreRelativePath('src/.gitignore'), false)
  assert.equal(shouldIgnoreRelativePath('.git/config'), true)
  assert.equal(shouldIgnoreRelativePath('blueprints/login.json'), true)
  assert.equal(shouldIgnoreRelativePath('apps/web/blueprints/auth.json'), true)
  assert.equal(
    shouldIgnoreRelativePath('apps/explorer/src/data/vite/deps/three.js'),
    true,
  )
  assert.equal(shouldIgnoreRelativePath('inbase-dev/codebase.json'), true)
  assert.equal(shouldIgnoreRelativePath('apps/web/vite.config.ts'), false)
})

test('skips nested junk directories when scanning a monorepo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-coder-mono-'))
  const dest = path.join(root, 'codebase.json')
  try {
    fs.mkdirSync(path.join(root, 'apps/web/src'), { recursive: true })
    fs.mkdirSync(path.join(root, 'apps/web/node_modules/pkg'), { recursive: true })
    fs.mkdirSync(path.join(root, 'packages/ui/src'), { recursive: true })
    fs.mkdirSync(path.join(root, 'packages/ui/dist'), { recursive: true })
    fs.mkdirSync(path.join(root, 'node_modules/three'), { recursive: true })
    fs.writeFileSync(path.join(root, 'apps/web/src/app.ts'), 'export const app = 1\n')
    fs.writeFileSync(
      path.join(root, 'apps/web/node_modules/pkg/index.js'),
      'export default 1\n',
    )
    fs.writeFileSync(path.join(root, 'apps/web/package-lock.json'), '{}\n')
    fs.writeFileSync(path.join(root, 'packages/ui/src/index.ts'), 'export const ui = 1\n')
    fs.writeFileSync(path.join(root, 'packages/ui/dist/index.js'), 'export const ui = 1\n')
    fs.writeFileSync(path.join(root, 'node_modules/three/index.js'), 'export default {}\n')

    const graph = scanQuiet({ root, dest })
    const ids = graph.files.map((file) => file.id).sort()
    assert.deepEqual(ids, ['apps/web/src/app.ts', 'packages/ui/src/index.ts'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('honours nested gitignore files in a monorepo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-coder-gitignore-'))
  const dest = path.join(root, 'codebase.json')
  try {
    fs.mkdirSync(path.join(root, 'apps/web/src'), { recursive: true })
    fs.mkdirSync(path.join(root, 'apps/web/generated'), { recursive: true })
    fs.mkdirSync(path.join(root, 'apps/web/node_modules/pkg'), { recursive: true })
    fs.writeFileSync(path.join(root, 'apps/web/.gitignore'), 'generated/\n')
    fs.writeFileSync(path.join(root, 'apps/web/src/ok.ts'), 'export const ok = 1\n')
    fs.writeFileSync(path.join(root, 'apps/web/generated/skip.ts'), 'export const skip = 1\n')
    fs.writeFileSync(
      path.join(root, 'apps/web/node_modules/pkg/index.js'),
      'export default 1\n',
    )

    const graph = scanQuiet({ root, dest })
    const ids = graph.files.map((file) => file.id).sort()
    assert.deepEqual(ids, ['apps/web/.gitignore', 'apps/web/src/ok.ts'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('skips the explorer data directory when it lives inside the scan root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-coder-data-skip-'))
  const dataDir = path.join(root, 'apps/explorer/src/data')
  const dest = path.join(dataDir, 'codebase.json')
  try {
    fs.mkdirSync(path.join(root, 'apps/web/src'), { recursive: true })
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(path.join(root, 'apps/web/src/app.ts'), 'export const app = 1\n')
    fs.writeFileSync(path.join(dataDir, 'user-context.json'), '{}\n')
    const graph = scanQuiet({ root, dest })
    const ids = graph.files.map((file) => file.id).sort()
    assert.deepEqual(ids, ['apps/web/src/app.ts'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
