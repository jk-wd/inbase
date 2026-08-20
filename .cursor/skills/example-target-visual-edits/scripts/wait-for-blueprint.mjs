#!/usr/bin/env node

import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = process.cwd()
const dataDir = path.resolve(repoRoot, 'apps/explorer/src/data')
const sessionStorePath = path.resolve(
  repoRoot,
  'apps/explorer/scripts/session-store.mjs',
)
const { readBlueprint, readManifest } = await import(
  pathToFileURL(sessionStorePath).href
)
const sessionIndex = process.argv.indexOf('--session')
const sessionId = sessionIndex >= 0 ? process.argv[sessionIndex + 1] : null

const timeoutMs = Number(
  process.argv.includes('--timeout')
    ? process.argv[process.argv.indexOf('--timeout') + 1]
    : 600000,
)

if (!sessionId) {
  console.error(
    'Usage: wait-for-blueprint.mjs --session <cursor-chat-id> [--timeout ms]',
  )
  process.exit(1)
}

const started = Date.now()
const initial = readManifest(dataDir, sessionId)
if (!initial) {
  console.error(`No workflow session found for ${sessionId}`)
  process.exit(1)
}

if (initial.phase === 'blueprint_ask' || initial.phase === 'blueprint') {
  console.log(
    initial.phase === 'blueprint_ask'
      ? `Waiting for the user to choose Setup blueprint: Yes or No...`
      : `Waiting for the user to send the blueprint...`,
  )
} else {
  console.log(`Blueprint handshake already finished for session ${sessionId}.`)
}

while (Date.now() - started < timeoutMs) {
  const manifest = readManifest(dataDir, sessionId)
  if (!manifest) {
    console.error(
      'VISUAL_CODER_STOPPED The workflow was stopped. Do not modify example-target files.',
    )
    process.exit(2)
  }
  if (manifest.phase === 'stopped') {
    console.error(
      'VISUAL_CODER_STOPPED The workflow was stopped. Do not modify example-target files.',
    )
    process.exit(2)
  }
  if (manifest.phase !== 'blueprint_ask' && manifest.phase !== 'blueprint') {
    const blueprint = readBlueprint(dataDir, sessionId)
    const blocks = blueprint.userCreatedBlocks ?? []
    const islands = blueprint.userCreatedIslands ?? []
    console.log(
      blueprint.enabled
        ? `VISUAL_CODER_BLUEPRINT_READY The user sent ${blocks.length} file(s) and ${islands.length} island(s) for this chat. Create those paths in the plan even if they are not on disk.`
        : 'VISUAL_CODER_BLUEPRINT_READY The user skipped the blueprint. Continue without user-placed files or islands.',
    )
    console.log('VISUAL_CODER_BLUEPRINT_START')
    console.log(JSON.stringify(blueprint, null, 2))
    console.log('VISUAL_CODER_BLUEPRINT_END')
    process.exit(0)
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
}

console.error('Timed out waiting for the blueprint handshake. Do not modify files.')
process.exit(3)
