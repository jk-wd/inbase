import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  collectImportSpecifiers,
  extractImportBindings,
  extractJsSymbols,
  resolveSpecifierAgainst,
} from './js-source.mjs'
import { scanTarget } from './scan-target.mjs'

test('resolves specifiers to any known file, not only JS extensions', () => {
  const known = new Set(['src/Header.astro', 'src/lib/index.vue'])
  assert.equal(resolveSpecifierAgainst('src/Header.astro', known), 'src/Header.astro')
  assert.equal(resolveSpecifierAgainst('src/Header', known), 'src/Header.astro')
  assert.equal(resolveSpecifierAgainst('src/lib', known), 'src/lib/index.vue')
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

test('scans every text file and language-specific extras', () => {
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
    fs.writeFileSync(path.join(root, 'photo.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]))

    const log = console.log
    console.log = () => {}
    const graph = scanTarget({ root, dest })
    console.log = log

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
    assert.equal(byId['photo.bin'], undefined)
    assert.deepEqual(byId['app.ts'].symbols, [
      { name: 'boot', kind: 'function' },
      { name: 'AppComponent', kind: 'class' },
    ])
    assert.deepEqual(byId['server.cjs'].imports, ['helper.cjs'])
    assert.deepEqual(byId['index.astro'].imports, ['Header.astro'])
    assert.deepEqual(byId['page.astro'].imports, ['Header.astro'])
    assert.deepEqual(byId['styles.scss'].symbols, [])
    assert.deepEqual(byId['script.py'].symbols, [])
    assert.equal(byId['styles.scss'].language, 'scss')
    assert.equal(byId['Header.astro'].language, 'astro')
    assert.equal(byId['Dockerfile'].language, 'txt')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
