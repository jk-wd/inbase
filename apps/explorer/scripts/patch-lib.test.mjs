import assert from 'node:assert/strict'
import test from 'node:test'
import {
  accumulatePatchAdditions,
  applyUnifiedPatchToContents,
  extractPatchAdditions,
  extractPatchImports,
  parseUnifiedPatch,
} from './patch-lib.mjs'

const newApi = `--- /dev/null
+++ b/src/mocked-api/weeklyVisitors.ts
@@ -0,0 +1,12 @@
+import type { Point } from './points'
+import { formatDay } from './points'
+
+const WEEKLY_VISITORS = [{ day: 'Mon', visitors: 1240 }]
+
+export function fetchWeeklyVisitors() {
+  return WEEKLY_VISITORS
+}
`

const addClockToHome = `--- a/src/pages/Home.tsx
+++ b/src/pages/Home.tsx
@@ -1,3 +1,8 @@
+import { useState } from 'react'
+import { Clock } from '../components/Clock'
 import { Counter } from '../components/Counter'
 
 export function Home() {
+  const [open, setOpen] = useState(false)
+  return <Clock />
 }
`

const tweakExisting = `--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
-export const value = 1
+export const value = 2
`

test('extracts added functions, variables, and import names from a new file', () => {
  const parsed = parseUnifiedPatch(newApi)
  const additions = extractPatchAdditions(parsed.entries)
  assert.deepEqual(additions.addedFunctions, [
    { name: 'fetchWeeklyVisitors', file: 'src/mocked-api/weeklyVisitors.ts' },
  ])
  assert.deepEqual(additions.addedVariables, [
    { name: 'WEEKLY_VISITORS', file: 'src/mocked-api/weeklyVisitors.ts' },
  ])
  assert.deepEqual(additions.addedImports, [
    { name: 'Point', from: './points', file: 'src/mocked-api/weeklyVisitors.ts' },
    { name: 'formatDay', from: './points', file: 'src/mocked-api/weeklyVisitors.ts' },
  ])
})

test('extracts added imports, functions, and variables from a modified file', () => {
  const parsed = parseUnifiedPatch(addClockToHome)
  const additions = extractPatchAdditions(parsed.entries)
  assert.deepEqual(additions.addedFunctions, [])
  assert.deepEqual(additions.addedVariables, [
    { name: 'open', file: 'src/pages/Home.tsx' },
    { name: 'setOpen', file: 'src/pages/Home.tsx' },
  ])
  assert.deepEqual(additions.addedImports, [
    { name: 'useState', from: 'react', file: 'src/pages/Home.tsx' },
    { name: 'Clock', from: '../components/Clock', file: 'src/pages/Home.tsx' },
  ])
})

test('does not treat a rewritten existing binding as added', () => {
  const parsed = parseUnifiedPatch(tweakExisting)
  assert.deepEqual(extractPatchAdditions(parsed.entries), {
    addedFunctions: [],
    addedVariables: [],
    addedImports: [],
  })
})

test('accumulates additions across diffs and drops deleted files', () => {
  const addThenDelete = [
    newApi,
    `--- a/src/mocked-api/weeklyVisitors.ts
+++ /dev/null
@@ -1,12 +0,0 @@
-import type { Point } from './points'
-import { formatDay } from './points'
-
-const WEEKLY_VISITORS = [{ day: 'Mon', visitors: 1240 }]
-
-export function fetchWeeklyVisitors() {
-  return WEEKLY_VISITORS
-}
`,
  ]
  const afterAdd = accumulatePatchAdditions([newApi])
  assert.equal(afterAdd.addedFunctions[0]?.name, 'fetchWeeklyVisitors')
  assert.deepEqual(accumulatePatchAdditions(addThenDelete), {
    addedFunctions: [],
    addedVariables: [],
    addedImports: [],
  })
})

const addAngularClass = `--- /dev/null
+++ b/src/app.component.ts
@@ -0,0 +1,8 @@
+import { Component } from '@angular/core'
+
+@Component({ selector: 'app-root', template: '' })
+export class AppComponent {
+  title = 'demo'
+}
`

const addCjsRequire = `--- /dev/null
+++ b/src/server.cjs
@@ -0,0 +1,4 @@
+const helper = require('./helper')
+const { format } = require('./format')
+require('./side-effect')
`

test('treats added classes as functions in patch previews', () => {
  const parsed = parseUnifiedPatch(addAngularClass)
  const additions = extractPatchAdditions(parsed.entries)
  assert.deepEqual(additions.addedFunctions, [
    { name: 'AppComponent', file: 'src/app.component.ts' },
  ])
})

test('extracts require() bindings and relative edges', () => {
  const parsed = parseUnifiedPatch(addCjsRequire)
  const additions = extractPatchAdditions(parsed.entries)
  assert.deepEqual(additions.addedImports, [
    { name: 'helper', from: './helper', file: 'src/server.cjs' },
    { name: 'format', from: './format', file: 'src/server.cjs' },
    { name: './side-effect', from: './side-effect', file: 'src/server.cjs' },
  ])
  assert.deepEqual(
    extractPatchImports(parsed.entries, [
      'src/helper.js',
      'src/format.cjs',
      'src/side-effect.mjs',
    ]),
    [
      { from: 'src/server.cjs', to: 'src/helper.js' },
      { from: 'src/server.cjs', to: 'src/format.cjs' },
      { from: 'src/server.cjs', to: 'src/side-effect.mjs' },
    ],
  )
})

test('applies a patch chain in memory without a temp project copy', () => {
  const files = new Map([['src/a.ts', 'export const value = 1\n']])
  applyUnifiedPatchToContents(
    files,
    '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 2\n',
  )
  assert.equal(files.get('src/a.ts'), 'export const value = 2\n')
  applyUnifiedPatchToContents(
    files,
    '--- /dev/null\n+++ b/src/b.ts\n@@ -0,0 +1,1 @@\n+export const extra = 1\n',
  )
  assert.equal(files.get('src/b.ts'), 'export const extra = 1\n')
  assert.throws(
    () =>
      applyUnifiedPatchToContents(
        files,
        '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-export const value = 1\n+export const value = 9\n',
      ),
    /Hunk does not apply/,
  )
})
