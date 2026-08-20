#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = process.cwd()
const dataDir = path.resolve(repoRoot, 'apps/explorer/src/data')
const patchLibPath = path.resolve(repoRoot, 'apps/explorer/scripts/patch-lib.mjs')
const sessionStorePath = path.resolve(
  repoRoot,
  'apps/explorer/scripts/session-store.mjs',
)
const targetRoot = path.resolve(repoRoot, 'apps/example-target')

const { parseUnifiedPatch } = await import(
  pathToFileURL(patchLibPath).href
)
const { appendDiff, stopSession } = await import(pathToFileURL(sessionStorePath).href)

function takeFlagValues(args, flag) {
  const values = []
  const rest = []
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag && args[i + 1]) {
      values.push(args[i + 1])
      i += 1
      continue
    }
    rest.push(args[i])
  }
  return { values, rest }
}

const raw = process.argv.slice(2)
const clear = raw.includes('--clear')
const withoutClear = raw.filter((arg) => arg !== '--clear')
const sessionParsed = takeFlagValues(withoutClear, '--session')
const patchFile = sessionParsed.rest[0]
const sessionId = sessionParsed.values[0]

if (clear) {
  if (!sessionId) {
    console.error('Usage: propose-patch.mjs --session <cursor-chat-id> --clear')
    process.exit(1)
  }
  stopSession(dataDir, sessionId)
  console.log(`Cleared session ${sessionId}; stored diffs and blueprint drafts were removed.`)
  process.exit(0)
}

if (!sessionId || !patchFile) {
  console.error(
    'Usage: propose-patch.mjs --session <cursor-chat-id> <file.patch|->',
  )
  process.exit(1)
}

let patchText = ''
if (patchFile && patchFile !== '-') {
  const from = path.resolve(repoRoot, patchFile)
  patchText = fs.readFileSync(from, 'utf8')
} else if (patchFile === '-') {
  patchText = fs.readFileSync(0, 'utf8')
}

if (!patchText.trim()) {
  console.error('No unified diff provided. Pass a .patch file or use stdin.')
  process.exit(1)
}

const parsed = parseUnifiedPatch(patchText)
if (parsed.entries.length === 0) {
  console.error('Patch did not contain any file changes.')
  process.exit(1)
}

const { entry, manifest } = appendDiff(dataDir, targetRoot, {
  sessionId,
  patchText,
})

console.log(
  `VISUAL_CODER_STEP_READY Published diff ${entry.id} for session ${sessionId}, step ${entry.step}/${manifest.steps.length}: ${parsed.files.length} changed, ${parsed.creates.length} added. Wait for Continue or an alternative instruction.`,
)
