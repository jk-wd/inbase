#!/usr/bin/env node

import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = process.cwd()
const dataDir = path.resolve(repoRoot, 'apps/explorer/src/data')
const storePath = path.resolve(repoRoot, 'apps/explorer/scripts/session-store.mjs')
const { startSession } = await import(pathToFileURL(storePath).href)

function takeFlagValue(args, flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : null
}

const args = process.argv.slice(2)
const sessionId = takeFlagValue(args, '--session')
const feature = takeFlagValue(args, '--feature')

if (!sessionId) {
  console.error(
    'Usage: start-session.mjs --session <cursor-chat-id> [--feature "name"]',
  )
  process.exit(1)
}

const manifest = startSession(dataDir, { sessionId, feature })
if (manifest.phase === 'blueprint_ask' || manifest.phase === 'blueprint') {
  console.log(
    `VISUAL_CODER_BLUEPRINT_WAIT Session ${sessionId} is visible in the visualizer (${manifest.phase}). Wait with wait-for-blueprint.mjs before drafting the plan.`,
  )
} else {
  console.log(
    `VISUAL_CODER_PREPARING Session ${sessionId} is visible in the visualizer (${manifest.phase}). Draft the plan next with report-plan.mjs.`,
  )
}
