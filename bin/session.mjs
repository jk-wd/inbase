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

function printAck(kind, detail) {
  console.log(`VISUAL_CODER_ACK ${kind}: ${detail}`)
}

export function createManifestGate(manifestPath, watch = fs.watch) {
  const dir = path.dirname(manifestPath)
  let wake = () => {}
  let watcher = null

  const dropWatcher = () => {
    try {
      watcher?.close()
    } catch {
      // Already closed after an error, or never opened.
    }
    watcher = null
  }

  try {
    watcher = watch(dir, () => wake())
    watcher?.on?.('error', () => {
      // EMFILE and sandbox limits must not crash wait-for-approval. Poll instead.
      dropWatcher()
      wake()
    })
  } catch {
    dropWatcher()
  }

  return {
    wait(ms) {
      return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms)
        wake = () => {
          clearTimeout(timer)
          resolve()
        }
      })
    },
    close() {
      dropWatcher()
    },
  }
}

function signalAck(store, dataDir, sessionId, kind, detail) {
  printAck(kind, detail)
  try {
    store.recordSessionAck(dataDir, sessionId, kind, detail)
  } catch {
    // Session folder may already be gone.
  }
}

function waitingMessage(sessionId, manifest) {
  if (manifest.phase === 'plan_ready') {
    return `Waiting for the user to invoke step ${manifest.currentStep}...`
  }
  if (manifest.phase === 'review' && manifest.diffs?.at(-1)) {
    return manifest.stepByStep === false
      ? `Waiting for the user to accept the proposal after ${manifest.diffs.at(-1).id}...`
      : `Waiting for the user to accept the proposal on ${manifest.diffs.at(-1).id}...`
  }
  return `Waiting for the visual workflow in session ${sessionId}...`
}

function emitStopped(store, dataDir, sessionId) {
  if (store && dataDir && sessionId) {
    signalAck(store, dataDir, sessionId, 'stopped', 'the workflow was stopped')
  } else {
    printAck('stopped', 'the workflow was stopped')
  }
  console.error(
    'VISUAL_CODER_STOPPED The workflow was stopped. Do not modify project files.',
  )
  process.exit(2)
}

function emitApprovalHandshake(store, dataDir, sessionId, manifest, initialDiff) {
  const current = initialDiff
    ? manifest?.diffs.find((entry) => entry.id === initialDiff.id)
    : null
  if (!manifest || manifest.phase === 'stopped' || current?.status === 'rejected') {
    emitStopped(store, dataDir, sessionId)
    return
  }
  if (manifest.phase === 'finished') {
    signalAck(store, dataDir, sessionId, 'finished', 'the final step was accepted')
    console.log(
      `VISUAL_CODER_FINISHED The final step was applied. Feature is done. Run inbase propose-patch --session ${sessionId} --clear, then tell the user it is finished.`,
    )
    process.exit(5)
  }
  if (manifest.phase === 'working') {
    const next = manifest.steps.find((step) => step.index === manifest.currentStep)
    const title = next?.title
    signalAck(
      store,
      dataDir,
      sessionId,
      'execute',
      title
        ? `step ${manifest.currentStep} — ${title}`
        : `step ${manifest.currentStep}`,
    )
    const continuing = (manifest.diffs?.length ?? 0) > 0
    console.log(
      continuing
        ? `VISUAL_CODER_EXECUTE Step ${manifest.currentStep} is invoked${title ? `: ${title}` : ''}. Continue immediately: edit live files for this step only, then inbase propose-patch --session ${sessionId} with no patch file. Do not explore, re-plan, or run wait-for-blueprint.`
        : `VISUAL_CODER_EXECUTE Step ${manifest.currentStep} is invoked${title ? `: ${title}` : ''}. Re-read this session's blueprint.json before implementing; the user can place files and islands on any step. Edit the live project files for this step only (Write, StrReplace, Delete). Then record the step with inbase propose-patch --session ${sessionId} — no patch file. Inbase diffs those edits against the invoke snapshot and stores the patch. Do not write a unified diff yourself.`,
    )
    process.exit(0)
  }
  if (manifest.phase === 'replanning') {
    signalAck(
      store,
      dataDir,
      sessionId,
      'replan',
      `revise the plan from step ${manifest.currentStep}`,
    )
    const instruction = manifest.pendingInstruction
      ? `\nVISUAL_CODER_INSTRUCTION_START\n${manifest.pendingInstruction}\nVISUAL_CODER_INSTRUCTION_END`
      : ''
    console.log(
      `VISUAL_CODER_REPLAN Keep accepted patch files before step ${manifest.currentStep}. Disk is baseline + accepted patches. Do not edit project files until the next EXECUTE. The session blueprint remains leading; if this instruction would differ from it, ask the user before replacing the plan. Report the revised tail with inbase report-plan, then wait for invocation.${instruction}`,
    )
    process.exit(4)
  }
}

export async function startSession(args) {
  const { store, config } = await loadExplorer()
  const sessionId = takeFlagValue(args, '--session')
  const name = takeFlagValue(args, '--name') || takeFlagValue(args, '--feature')
  const feature = takeFlagValue(args, '--feature')
  if (!sessionId || !name) {
    usage('start-session', '--session <cursor-chat-id> --name "short name"')
  }

  const manifest = store.startSession(config.dataDir, { sessionId, name, feature })
  console.log(
    `VISUAL_CODER_BLUEPRINT_WAIT Session ${manifest.name || sessionId} is visible in the visualizer (${manifest.phase}). Wait with inbase wait-for-blueprint before drafting the plan. A running visualizer does not skip this handshake.`,
  )
}

export async function attachSession(args) {
  const { store, config } = await loadExplorer()
  const sessionId = takeFlagValue(args, '--session')
  const manifest = store.attachSession(config.dataDir, sessionId)
  console.log(`VISUAL_CODER_SESSION ${manifest.sessionId}`)
  printAck('attached', manifest.name || manifest.sessionId)
  console.log(
    `VISUAL_CODER_ATTACHED Attached to the next waiting visualizer session ${manifest.name || manifest.sessionId} (${manifest.phase}). Use --session ${manifest.sessionId} for every later command. Run inbase wait-for-blueprint --session ${manifest.sessionId} to read the optional blueprint and instruction; it does not wait.`,
  )
}

export async function waitForBlueprint(args) {
  const { store, config } = await loadExplorer()
  const sessionId = takeFlagValue(args, '--session')
  if (!sessionId) usage('wait-for-blueprint', '--session <cursor-chat-id>')

  if (store.isWorkflowStopped(config.dataDir, sessionId)) {
    emitStopped(store, config.dataDir, sessionId)
  }
  const initial = store.readManifest(config.dataDir, sessionId)
  if (!initial) {
    console.error(`No workflow session found for ${sessionId}`)
    process.exit(1)
  }

  store.touchSessionConnection(config.dataDir, sessionId)
  store.maybeStartVisualizerHandshake(config.dataDir, sessionId)
  const manifest = store.readManifest(config.dataDir, sessionId)
  if (!manifest || manifest.phase === 'stopped') {
    emitStopped(store, config.dataDir, sessionId)
  }

  const blueprint = store.readBlueprint(config.dataDir, sessionId)
  const blocks = blueprint.userCreatedBlocks ?? []
  const islands = blueprint.userCreatedIslands ?? []
  signalAck(
    store,
    config.dataDir,
    sessionId,
    'blueprint',
    blueprint.enabled
      ? `${blocks.length} file(s), ${islands.length} island(s)`
      : 'none',
  )
  console.log(
    blueprint.enabled
      ? `VISUAL_CODER_BLUEPRINT_READY The session started with ${blocks.length} file(s) and ${islands.length} island(s). The blueprint is leading: create those paths and honor addedFunctions, addedVariables, and addedImports even if they are not on disk. Do not omit, rename, relocate, or replace them. Extra new files not in the blueprint are a deviation. If you would differ from the blueprint, ask the user first; do not silently deviate. The user can still place files and islands on later steps; re-read this session's blueprint.json before each step.`
      : 'VISUAL_CODER_BLUEPRINT_READY The session started without a blueprint. They can still place files and islands on later steps; re-read this session\'s blueprint.json before each step. Continue without user-placed files until that file is enabled.',
  )
  console.log('VISUAL_CODER_BLUEPRINT_START')
  console.log(JSON.stringify(blueprint, null, 2))
  console.log('VISUAL_CODER_BLUEPRINT_END')
  const instruction =
    typeof manifest.initialInstruction === 'string'
      ? manifest.initialInstruction.trim()
      : ''
  if (instruction) {
    console.log(
      'Honor the user\'s initial instruction between VISUAL_CODER_INSTRUCTION_START and END together with the blueprint.',
    )
    console.log('VISUAL_CODER_INSTRUCTION_START')
    console.log(instruction)
    console.log('VISUAL_CODER_INSTRUCTION_END')
  }
  process.exit(0)
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
    targetRoot: config.targetRoot,
  })
  console.log(
    manifest.phase === 'working'
      ? `VISUAL_CODER_PLAN_READY Reported ${manifest.steps.length} plan step(s) for session ${sessionId}. Step by step is off, so step ${manifest.currentStep} is already invoked. Edit the live files for that step, then inbase propose-patch --session ${sessionId} with no patch file.`
      : `VISUAL_CODER_PLAN_READY Reported ${manifest.steps.length} plan step(s) for session ${sessionId}. Wait for the user to invoke step ${manifest.currentStep}.`,
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
    emitStopped(store, config.dataDir, sessionId)
  }
  if (!initial) {
    console.error(`No workflow session found for ${sessionId}`)
    process.exit(1)
  }
  store.autoAdvance(config.dataDir, sessionId, config.targetRoot)

  const { manifest: manifestPath } = store.sessionPaths(config.dataDir, sessionId)
  const gate = createManifestGate(manifestPath)
  let lastWaiting = null
  try {
    while (Date.now() - started < timeoutMs) {
      store.touchSessionConnection(config.dataDir, sessionId)
      store.autoAdvance(config.dataDir, sessionId, config.targetRoot)
      const manifest = store.readManifest(config.dataDir, sessionId)
      emitApprovalHandshake(store, config.dataDir, sessionId, manifest, initialDiff)
      if (!manifest) continue
      const waiting = waitingMessage(sessionId, manifest)
      if (waiting !== lastWaiting) {
        console.log(waiting)
        lastWaiting = waiting
      }
      await gate.wait(50)
    }
  } finally {
    gate.close()
  }

  signalAck(store, config.dataDir, sessionId, 'timeout', 'no visualizer signal')
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

  if (!sessionId) {
    usage('propose-patch', '--session <cursor-chat-id> [file.patch|-]')
  }

  let patchText
  if (patchFile && patchFile !== '-') {
    patchText = fs.readFileSync(path.resolve(cwd, patchFile), 'utf8')
  } else if (patchFile === '-') {
    patchText = fs.readFileSync(0, 'utf8')
  }

  if (patchFile && !patchText.trim()) {
    console.error('No unified diff provided. Pass a .patch file, use stdin, or omit the file to record live edits.')
    process.exit(1)
  }

  let recorded
  try {
    recorded = store.appendDiff(config.dataDir, config.targetRoot, {
      sessionId,
      ...(patchText !== undefined ? { patchText } : {}),
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
  const { entry, manifest } = recorded

  const parsed = patchLib.parseUnifiedPatch(
    store.readDiff(config.dataDir, sessionId, entry),
  )

  const last = entry.step >= manifest.steps.length
  console.log(
    manifest.phase === 'working'
      ? `VISUAL_CODER_STEP_READY Recorded live edits as patch ${entry.id} for session ${sessionId}, step ${entry.step}/${manifest.steps.length}: ${parsed.files.length} changed, ${parsed.creates.length} added. Do not keep editing until the next EXECUTE. Step by step is off, so the next step is already invoked. Wait again.`
      : last
        ? `VISUAL_CODER_STEP_READY Recorded live edits as patch ${entry.id} for session ${sessionId}, step ${entry.step}/${manifest.steps.length}: ${parsed.files.length} changed, ${parsed.creates.length} added. Do not keep editing. Walk the diffs, then Accept proposal to finish.`
        : `VISUAL_CODER_STEP_READY Recorded live edits as patch ${entry.id} for session ${sessionId}, step ${entry.step}/${manifest.steps.length}: ${parsed.files.length} changed, ${parsed.creates.length} added. Immediately run wait-for-approval. Do not explore or plan. Accept proposal invokes the next step; when EXECUTE returns, implement that step at once.`,
  )
}
