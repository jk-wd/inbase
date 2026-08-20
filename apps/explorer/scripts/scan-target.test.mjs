import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  collectImportSpecifiers,
  extractImportBindings,
  extractJsSymbols,
} from './js-source.mjs'
import { scanTarget } from './scan-target.mjs'

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

test('scans classes, require edges, and extra file types', () => {
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
    fs.writeFileSync(path.join(root, 'ignored.py'), 'print("no")\n')

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
    assert.equal(byId['ignored.py'], undefined)
    assert.deepEqual(byId['app.ts'].symbols, [
      { name: 'boot', kind: 'function' },
      { name: 'AppComponent', kind: 'class' },
    ])
    assert.deepEqual(byId['server.cjs'].imports, ['helper.cjs'])
    assert.deepEqual(byId['styles.scss'].symbols, [])
    assert.equal(byId['styles.scss'].language, 'scss')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
