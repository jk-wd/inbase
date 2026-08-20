#!/usr/bin/env node

import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = process.cwd()
const dataDir = path.resolve(repoRoot, 'apps/explorer/src/data')
const sessionStorePath = path.resolve(
  repoRoot,
  'apps/explorer/scripts/session-store.mjs',
)
const { isWorkflowStopped, readManifest, touchSessionConnection } = await import(pathToFileURL(sessionStorePath).href)
const sessionIndex = process.argv.indexOf('--session')
const sessionId = sessionIndex >= 0 ? process.argv[sessionIndex + 1] : null

const timeoutMs = Number(
  process.argv.includes('--timeout')
    ? process.argv[process.argv.indexOf('--timeout') + 1]
    : 600000,
)

if (!sessionId) {
  console.error('Usage: wait-for-approval.mjs --session <cursor-chat-id> [--timeout ms]')
  process.exit(1)
}

const started = Date.now()
const initial = readManifest(dataDir, sessionId)
const initialDiff = initial?.diffs?.at(-1)
if (isWorkflowStopped(dataDir, sessionId)) {
  console.error(
    'VISUAL_CODER_STOPPED The workflow was stopped. Do not modify example-target files.',
  )
  process.exit(2)
}
if (!initial) {
  console.error(`No workflow session found for ${sessionId}`)
  process.exit(1)
}
console.log(
  initial.phase === 'plan_ready'
    ? `Waiting for the user to invoke step ${initial.currentStep}...`
    : initial.phase === 'review' && initialDiff
      ? `Waiting for the user to run the next step after ${initialDiff.id}...`
      : `Waiting for the visual workflow in session ${sessionId}...`,
)

while (Date.now() - started < timeoutMs) {
  touchSessionConnection(dataDir, sessionId)
  const manifest = readManifest(dataDir, sessionId)
  if (!manifest) {
    console.error(
      'VISUAL_CODER_STOPPED The workflow was stopped. Do not modify example-target files.',
    )
    process.exit(2)
  }
  const current = initialDiff
    ? manifest.diffs.find((entry) => entry.id === initialDiff.id)
    : null

  if (manifest.phase === 'finished') {
    console.log(
      `VISUAL_CODER_FINISHED The final step was applied. Feature is done. Run propose-patch.mjs --session ${sessionId} --clear, then tell the user it is finished.`,
    )
    process.exit(5)
  }
  if (manifest.phase === 'working') {
    const next = manifest.steps.find((step) => step.index === manifest.currentStep)
    console.log(
      `VISUAL_CODER_EXECUTE Step ${manifest.currentStep} is invoked${next ? `: ${next.title}` : ''}. Implement only this step, publish its incremental diff with propose-patch.mjs --session ${sessionId}, then wait again.`,
    )
    process.exit(0)
  }
  if (manifest.phase === 'replanning') {
    const instruction = manifest.pendingInstruction
      ? `\nVISUAL_CODER_INSTRUCTION_START\n${manifest.pendingInstruction}\nVISUAL_CODER_INSTRUCTION_END`
      : ''
    console.log(
      `VISUAL_CODER_REPLAN Keep accepted steps before step ${manifest.currentStep}. Replace the plan from step ${manifest.currentStep} onward using the instruction below. The session blueprint remains leading; if this instruction would differ from it, ask the user before replacing the plan. Report the revised tail with report-plan.mjs, then wait for invocation.${instruction}`,
    )
    process.exit(4)
  }
  if (manifest.phase === 'stopped' || current?.status === 'rejected') {
    console.error(
      'VISUAL_CODER_STOPPED The workflow was stopped. Do not modify example-target files.',
    )
    process.exit(2)
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
}

console.error('Timed out waiting for visualizer review. Do not modify files.')
process.exit(3)
