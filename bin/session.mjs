import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { explorerRoot, takeFlagValue, takeFlagValues } from './project.mjs'

async function loadExplorer() {
  const storePath = pathToFileURL(
    path.join(explorerRoot, 'scripts/session-store.mjs'),
  ).href
  const patchPath = pathToFileURL(
    path.join(explorerRoot, 'scripts/patch-lib.mjs'),
  ).href
  const configPath = pathToFileURL(
    path.join(explorerRoot, 'scripts/target-config.mjs'),
  ).href
  const [store, patchLib, config] = await Promise.all([
    import(storePath),
    import(patchPath),
    import(configPath),
  ])
  return { store, patchLib, config }
}

function usage(name, example) {
  console.error(`Usage: inbase ${name} ${example}`)
  process.exit(1)
}

export async function startSession(args) {
  const { store, config } = await loadExplorer()
  const sessionId = takeFlagValue(args, '--session')
  const feature = takeFlagValue(args, '--feature')
  if (!sessionId) usage('start-session', '--session <cursor-chat-id> [--feature "name"]')

  const manifest = store.startSession(config.dataDir, { sessionId, feature })
  if (manifest.phase === 'blueprint_ask' || manifest.phase === 'blueprint') {
    console.log(
      `VISUAL_CODER_BLUEPRINT_WAIT Session ${sessionId} is visible in the visualizer (${manifest.phase}). Wait with inbase wait-for-blueprint before drafting the plan.`,
    )
  } else {
    console.log(
      `VISUAL_CODER_PREPARING Session ${sessionId} is visible in the visualizer (${manifest.phase}). Draft the plan next with inbase report-plan.`,
    )
  }
}

export async function waitForBlueprint(args) {
  const { store, config } = await loadExplorer()
  const sessionId = takeFlagValue(args, '--session')
  const timeoutMs = Number(takeFlagValue(args, '--timeout') ?? 600000)
  if (!sessionId) usage('wait-for-blueprint', '--session <cursor-chat-id> [--timeout ms]')

  const started = Date.now()
  const initial = store.readManifest(config.dataDir, sessionId)
  if (store.isWorkflowStopped(config.dataDir, sessionId)) {
    console.error(
      'VISUAL_CODER_STOPPED The workflow was stopped. Do not modify project files.',
    )
    process.exit(2)
  }
  if (!initial) {
    console.error(`No workflow session found for ${sessionId}`)
    process.exit(1)
  }

  if (initial.phase === 'blueprint_ask' || initial.phase === 'blueprint') {
    console.log(
      initial.phase === 'blueprint_ask'
        ? 'Waiting for the user to choose Setup blueprint: Yes or No...'
        : 'Waiting for the user to send the blueprint...',
    )
  } else {
    console.log(`Blueprint handshake already finished for session ${sessionId}.`)
  }

  while (Date.now() - started < timeoutMs) {
    store.touchSessionConnection(config.dataDir, sessionId)
    const manifest = store.readManifest(config.dataDir, sessionId)
    if (!manifest || manifest.phase === 'stopped') {
      console.error(
        'VISUAL_CODER_STOPPED The workflow was stopped. Do not modify project files.',
      )
      process.exit(2)
    }
    if (manifest.phase !== 'blueprint_ask' && manifest.phase !== 'blueprint') {
      const blueprint = store.readBlueprint(config.dataDir, sessionId)
      const blocks = blueprint.userCreatedBlocks ?? []
      const islands = blueprint.userCreatedIslands ?? []
      console.log(
        blueprint.enabled
          ? `VISUAL_CODER_BLUEPRINT_READY The user sent ${blocks.length} file(s) and ${islands.length} island(s) for this chat. The blueprint is leading: create those paths and honor addedFunctions, addedVariables, and addedImports even if they are not on disk. Do not omit, rename, relocate, or replace them. Extra new files not in the blueprint are a deviation. If you would differ from the blueprint, ask the user first; do not silently deviate.`
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
}

export async function reportPlan(args) {
  const { store, config } = await loadExplorer()
  const sessionParsed = takeFlagValues(args, '--session')
  const featureParsed = takeFlagValues(sessionParsed.rest, '--feature')
  const stepsParsed = takeFlagValues(featureParsed.rest, '--steps')
  const sessionId = sessionParsed.values[0]
  const existing = sessionId ? store.readManifest(config.dataDir, sessionId) : null
  const feature = featureParsed.values[0] ?? existing?.feature

  if (!sessionId || !feature || stepsParsed.values.length === 0) {
    usage(
      'report-plan',
      '--session <cursor-chat-id> --feature "name" --steps "one" [--steps "two"]',
    )
  }

  const manifest = store.reportPlan(config.dataDir, {
    sessionId,
    feature,
    stepTitles: stepsParsed.values,
  })
  console.log(
    `VISUAL_CODER_PLAN_READY Reported ${manifest.steps.length} plan step(s) for session ${sessionId}. Wait for the user to invoke step ${manifest.currentStep}.`,
  )
}

export async function waitForApproval(args) {
  const { store, config } = await loadExplorer()
  const sessionId = takeFlagValue(args, '--session')
  const timeoutMs = Number(takeFlagValue(args, '--timeout') ?? 600000)
  if (!sessionId) usage('wait-for-approval', '--session <cursor-chat-id> [--timeout ms]')

  const started = Date.now()
  const initial = store.readManifest(config.dataDir, sessionId)
  const initialDiff = initial?.diffs?.at(-1)
  if (store.isWorkflowStopped(config.dataDir, sessionId)) {
    console.error(
      'VISUAL_CODER_STOPPED The workflow was stopped. Do not modify project files.',
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
    store.touchSessionConnection(config.dataDir, sessionId)
    const manifest = store.readManifest(config.dataDir, sessionId)
    if (!manifest) {
      console.error(
        'VISUAL_CODER_STOPPED The workflow was stopped. Do not modify project files.',
      )
      process.exit(2)
    }
    const current = initialDiff
      ? manifest.diffs.find((entry) => entry.id === initialDiff.id)
      : null

    if (manifest.phase === 'finished') {
      console.log(
        `VISUAL_CODER_FINISHED The final step was applied. Feature is done. Run inbase propose-patch --session ${sessionId} --clear, then tell the user it is finished.`,
      )
      process.exit(5)
    }
    if (manifest.phase === 'working') {
      const next = manifest.steps.find((step) => step.index === manifest.currentStep)
      console.log(
        `VISUAL_CODER_EXECUTE Step ${manifest.currentStep} is invoked${next ? `: ${next.title}` : ''}. Implement only this step, publish its incremental diff with inbase propose-patch --session ${sessionId}, then wait again.`,
      )
      process.exit(0)
    }
    if (manifest.phase === 'replanning') {
      const instruction = manifest.pendingInstruction
        ? `\nVISUAL_CODER_INSTRUCTION_START\n${manifest.pendingInstruction}\nVISUAL_CODER_INSTRUCTION_END`
        : ''
      console.log(
        `VISUAL_CODER_REPLAN Keep accepted steps before step ${manifest.currentStep}. Replace the plan from step ${manifest.currentStep} onward using the instruction below. The session blueprint remains leading; if this instruction would differ from it, ask the user before replacing the plan. Report the revised tail with inbase report-plan, then wait for invocation.${instruction}`,
      )
      process.exit(4)
    }
    if (manifest.phase === 'stopped' || current?.status === 'rejected') {
      console.error(
        'VISUAL_CODER_STOPPED The workflow was stopped. Do not modify project files.',
      )
      process.exit(2)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  console.error('Timed out waiting for visualizer review. Do not modify files.')
  process.exit(3)
}

export async function proposePatch(args) {
  const { store, patchLib, config } = await loadExplorer()
  const clear = args.includes('--clear')
  const withoutClear = args.filter((arg) => arg !== '--clear')
  const sessionParsed = takeFlagValues(withoutClear, '--session')
  const patchFile = sessionParsed.rest[0]
  const sessionId = sessionParsed.values[0]
  const cwd = process.cwd()

  if (clear) {
    if (!sessionId) usage('propose-patch', '--session <cursor-chat-id> --clear')
    store.stopSession(config.dataDir, sessionId, config.targetRoot)
    console.log(
      `Cleared session ${sessionId}; stored diffs and blueprint drafts were removed.`,
    )
    process.exit(0)
  }

  if (!sessionId || !patchFile) {
    usage('propose-patch', '--session <cursor-chat-id> <file.patch|->')
  }

  let patchText = ''
  if (patchFile && patchFile !== '-') {
    patchText = fs.readFileSync(path.resolve(cwd, patchFile), 'utf8')
  } else if (patchFile === '-') {
    patchText = fs.readFileSync(0, 'utf8')
  }

  if (!patchText.trim()) {
    console.error('No unified diff provided. Pass a .patch file or use stdin.')
    process.exit(1)
  }

  const parsed = patchLib.parseUnifiedPatch(patchText)
  if (parsed.entries.length === 0) {
    console.error('Patch did not contain any file changes.')
    process.exit(1)
  }

  const { entry, manifest } = store.appendDiff(config.dataDir, config.targetRoot, {
    sessionId,
    patchText,
  })

  console.log(
    `VISUAL_CODER_STEP_READY Published diff ${entry.id} for session ${sessionId}, step ${entry.step}/${manifest.steps.length}: ${parsed.files.length} changed, ${parsed.creates.length} added. Wait for Continue or an alternative instruction.`,
  )
}
