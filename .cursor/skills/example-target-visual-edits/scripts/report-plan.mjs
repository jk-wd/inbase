#!/usr/bin/env node

import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = process.cwd()
const dataDir = path.resolve(repoRoot, 'apps/explorer/src/data')
const storePath = path.resolve(repoRoot, 'apps/explorer/scripts/session-store.mjs')
const { readManifest, reportPlan } = await import(pathToFileURL(storePath).href)

function takeFlagValues(args, flag) {
  const values = []
  const rest = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) {
      values.push(args[index + 1])
      index += 1
    } else {
      rest.push(args[index])
    }
  }
  return { values, rest }
}

const sessionParsed = takeFlagValues(process.argv.slice(2), '--session')
const featureParsed = takeFlagValues(sessionParsed.rest, '--feature')
const stepsParsed = takeFlagValues(featureParsed.rest, '--steps')
const sessionId = sessionParsed.values[0]
const existing = sessionId ? readManifest(dataDir, sessionId) : null
const feature = featureParsed.values[0] ?? existing?.feature

if (!sessionId || !feature || stepsParsed.values.length === 0) {
  console.error(
    'Usage: report-plan.mjs --session <cursor-chat-id> --feature "name" --steps "one" [--steps "two"]',
  )
  process.exit(1)
}

const manifest = reportPlan(dataDir, {
  sessionId,
  feature,
  stepTitles: stepsParsed.values,
})
console.log(
  `VISUAL_CODER_PLAN_READY Reported ${manifest.steps.length} plan step(s) for session ${sessionId}. Wait for the user to invoke step ${manifest.currentStep}.`,
)
