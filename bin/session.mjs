import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { explorerRoot, instanceFile, readInstanceFile, takeFlagValue, takeFlagValues } from './project.mjs'

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
    return `Waiting for the user to /go step ${manifest.currentStep}...`
  }
  if (manifest.phase === 'review' && manifest.diffs?.at(-1)) {
    return manifest.stepByStep === false
      ? `Waiting for the user to /accept the proposal after ${manifest.diffs.at(-1).id}...`
      : `Waiting for the user to /accept the proposal on ${manifest.diffs.at(-1).id}...`
  }
  return `Waiting for the visual workflow in session ${sessionId}...`
}

function requireVisualizer(store, config) {
  if (!readInstanceFile(instanceFile(config.dataDir))) {
    console.error(store.NOT_RUNNING_MESSAGE)
    process.exit(1)
  }
}

function resolveCliSessionId(store, dataDir, args, command) {
  const sessionId = takeFlagValue(args, '--session') || store.readActiveSession(dataDir)
  if (!sessionId) usage(command, '[--session <cursor-chat-id>]')
  return sessionId
}

function proposalInfo(manifest) {
  if (!manifest) return null
  if (manifest.phase === 'review') {
    const active = manifest.diffs?.at(-1)
    if (!active || active.status !== 'pending') return null
    const title =
      manifest.steps?.find((item) => item.index === active.step)?.title ||
      active.title ||
      `step ${active.step}`
    return { phase: 'review', step: active.step, title, sessionId: manifest.sessionId }
  }
  if (manifest.phase === 'plan_ready') {
    const step = manifest.currentStep
    const title =
      manifest.steps?.find((item) => item.index === step)?.title || `step ${step}`
    return { phase: 'plan_ready', step, title, sessionId: manifest.sessionId }
  }
  return null
}

function readProposalInfo(store, dataDir, sessionId = null) {
  const id = sessionId || store.readActiveSession(dataDir)
  if (!id) return null
  return proposalInfo(store.readManifest(dataDir, id))
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

function emitTargetExplain(store, explain, dataDir, sessionId) {
  const consumed = explain.consumeExplainStart(dataDir)
  if (!consumed) return false
  const label = explain.explainTargetLabel(consumed)
  signalAck(store, dataDir, sessionId, 'explain', label)
  const quoted = JSON.stringify(consumed.question)
  console.log(
    `VISUAL_CODER_EXPLAIN The user clicked Explain on the ${label}. Do not edit project files. Do not accept or invoke the next step. Do not start the map walk overlay. The visualizer shows a single-explanation card. Run: npx inbase explain start --question ${quoted} Then inspect that ${consumed.kind} and where it fits in the codebase, and report one explanation with npx inbase explain report --question ${quoted} --step "..." --body "...". Use a single --step. After reporting, run npx inbase explain wait. If explain wait returns VISUAL_CODER_EXPLAIN for another file or folder, replace the explanation with one new step. When explain wait returns stopped or timeout, run wait-for-approval again.`,
  )
  process.exit(7)
}

function emitApprovalHandshake(store, explain, dataDir, sessionId, manifest, initialDiff, pendingStart) {
  manifest = store.readManifest(dataDir, sessionId) ?? manifest
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
  if (pendingStart) {
    emitTargetExplain(store, explain, dataDir, sessionId)
  }
  if (manifest.pendingExplain) {
    const reviewing = manifest.phase === 'review'
    const active = reviewing ? manifest.diffs?.at(-1) : null
    const step = active?.step ?? manifest.currentStep
    const title =
      manifest.steps?.find((item) => item.index === step)?.title ||
      active?.title ||
      `step ${step}`
    signalAck(
      store,
      dataDir,
      sessionId,
      'explain',
      `the proposal for ${title}`,
    )
    const target = reviewing
      ? 'inspect the live files this proposal changed'
      : 'inspect the live files and folders this plan step will use'
    const waiting = reviewing
      ? 'The proposal is still waiting for /accept.'
      : 'The plan is still waiting for /go.'
    console.log(
      `VISUAL_CODER_EXPLAIN The user invoked /explain for step ${step}: ${title}. Do not edit project files. Do not accept or invoke the next step. Start explain mode and report this proposal once. Do not walk the map after reporting — the UI reads the steps and the user navigates them. Run: npx inbase explain start --question "Explain the current proposal: ${title}" Then ${target} and report every step in one npx inbase explain report --question "Explain the current proposal: ${title}" --step "..." --body "..." --files path [--folders path] [--select path] [--zoom path] [--relations from:to] [--info] [--highlight function:name] [--point function:name]. After reporting, run npx inbase explain wait. If the user asks about a step, report sub-steps with --parent and wait again. When explain wait returns stopped or timeout, run wait-for-approval again. ${waiting}`,
    )
    process.exit(7)
  }
  if (manifest.phase === 'working') {
    const next = manifest.steps.find((step) => step.index === manifest.currentStep)
    const title = next?.title
    const guidance =
      typeof manifest.pendingInstruction === 'string'
        ? manifest.pendingInstruction.trim()
        : ''
    const updating = Boolean(guidance)
    signalAck(
      store,
      dataDir,
      sessionId,
      'execute',
      updating
        ? 'a new instruction'
        : title
          ? `step ${manifest.currentStep} — ${title}`
          : `step ${manifest.currentStep}`,
    )
    const instruction = updating
      ? `\nVISUAL_CODER_INSTRUCTION_START\n${guidance}\nVISUAL_CODER_INSTRUCTION_END`
      : ''
    const continuing = (manifest.diffs?.length ?? 0) > 0
    if (updating) {
      console.log(
        `VISUAL_CODER_EXECUTE Update the current proposal for step ${manifest.currentStep}${title ? `: ${title}` : ''}. Live files already contain that proposal — do not reset them. Follow the instruction between VISUAL_CODER_INSTRUCTION_START and END, edit those live files, then inbase propose-patch --session ${sessionId} with no patch file. Do not report a new plan.${instruction}`,
      )
    } else {
      console.log(
        continuing
          ? `VISUAL_CODER_EXECUTE Step ${manifest.currentStep} is invoked${title ? `: ${title}` : ''}. Continue immediately: edit live files for this step only, then inbase propose-patch --session ${sessionId} with no patch file. Do not explore, re-plan, or run wait-for-blueprint.`
          : `VISUAL_CODER_EXECUTE Step ${manifest.currentStep} is invoked${title ? `: ${title}` : ''}. Re-read the global blueprint.json and this session's local blueprint before implementing; the user can place files and islands at any time. Edit the live project files for this step only (Write, StrReplace, Delete). Then record the step with inbase propose-patch --session ${sessionId} — no patch file. Inbase diffs those edits against the invoke snapshot and stores the patch. Do not write a unified diff yourself.`,
      )
    }
    process.exit(0)
  }
  if (manifest.phase === 'replanning') {
    signalAck(
      store,
      dataDir,
      sessionId,
      'replan',
      `revise the current proposal for step ${manifest.currentStep}`,
    )
    const instruction = manifest.pendingInstruction
      ? `\nVISUAL_CODER_INSTRUCTION_START\n${manifest.pendingInstruction}\nVISUAL_CODER_INSTRUCTION_END`
      : ''
    console.log(
      `VISUAL_CODER_REPLAN Live files still contain the current proposal for step ${manifest.currentStep}. Do not reset them. Follow the instruction between VISUAL_CODER_INSTRUCTION_START and END, edit those live files, then inbase propose-patch. Do not report a new plan.${instruction}`,
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
  if (!readInstanceFile(instanceFile(config.dataDir))) {
    console.error(store.NOT_RUNNING_MESSAGE)
    process.exit(1)
  }
  const sessionId = takeFlagValue(args, '--session')
  const colorQuery = takeFlagValue(args, '--color')
  const manifest = store.attachSession(config.dataDir, sessionId, { color: colorQuery })
  const color = store.resolveSessionColor(manifest.color)
  const colorName = color?.name || null
  console.log(`VISUAL_CODER_SESSION ${manifest.sessionId}`)
  if (colorName) console.log(`VISUAL_CODER_COLOR ${colorName}`)
  printAck('attached', colorName || manifest.name || manifest.sessionId)
  console.log(
    colorName
      ? `VISUAL_CODER_ATTACHED Attached to the ${colorName} session (${manifest.phase}). Tell the user you connected to the ${colorName} chat. Use --session ${manifest.sessionId} for every later command. Run inbase wait-for-blueprint --session ${manifest.sessionId} to read the optional blueprint, instruction, and attached files; it does not wait. Then run wait-for-approval so map Explain clicks are heard.`
      : `VISUAL_CODER_ATTACHED Attached to the next waiting visualizer session ${manifest.name || manifest.sessionId} (${manifest.phase}). Use --session ${manifest.sessionId} for every later command. Run inbase wait-for-blueprint --session ${manifest.sessionId} to read the optional blueprint, instruction, and attached files; it does not wait. Then run wait-for-approval so map Explain clicks are heard.`,
  )
}

function printBlueprintDump(blueprint, options = {}) {
  const blocks = blueprint.userCreatedBlocks ?? []
  const islands = blueprint.userCreatedIslands ?? []
  const local = options.local === true
  const colorName = options.colorName || 'session'
  const readyTag = local
    ? 'VISUAL_CODER_LOCAL_BLUEPRINT_READY'
    : 'VISUAL_CODER_BLUEPRINT_READY'
  const startTag = local
    ? 'VISUAL_CODER_LOCAL_BLUEPRINT_START'
    : 'VISUAL_CODER_BLUEPRINT_START'
  const endTag = local
    ? 'VISUAL_CODER_LOCAL_BLUEPRINT_END'
    : 'VISUAL_CODER_BLUEPRINT_END'
  if (local) {
    console.log(
      blueprint.enabled
        ? `${readyTag} The ${colorName} session blueprint has ${blocks.length} file(s) and ${islands.length} island(s). This local blueprint is only for this ${colorName} chat. It is leading together with the global blueprint: create those paths and honor addedFunctions, addedVariables, addedImports, and notes even if they are not on disk. Do not omit, rename, relocate, or replace them. Extra new files not in either blueprint are a deviation. If you would differ from this local blueprint, ask the user first.`
        : `${readyTag} The ${colorName} session blueprint is empty. Only this ${colorName} chat can see a local blueprint if the user places one later.`,
    )
  } else {
    console.log(
      blueprint.enabled
        ? `${readyTag} The global blueprint has ${blocks.length} file(s) and ${islands.length} island(s). The global blueprint is shared with every session and is leading: create those paths and honor addedFunctions, addedVariables, addedImports, and notes even if they are not on disk. Notes are extra instructions or pseudo code for a file, function, or variable — follow them when implementing those items. Do not omit, rename, relocate, or replace them. Extra new files that are not in the global or this session's local blueprint are a deviation. If you would differ from the blueprint, ask the user first; do not silently deviate. The user can keep placing files and islands; re-read the global blueprint.json when it is printed again.`
        : `${readyTag} The global blueprint is empty. The user can still place files and islands on the global or this session's color; re-read the global blueprint.json when it is printed again. Continue without user-placed files until that file has content.`,
    )
  }
  console.log(startTag)
  console.log(JSON.stringify(blueprint, null, 2))
  console.log(endTag)
}

function printSessionBlueprints(store, dataDir, sessionId) {
  const global = store.readBlueprint(dataDir)
  const local = store.readLocalBlueprint(dataDir, sessionId)
  const colorName =
    store.resolveSessionColor(store.readManifest(dataDir, sessionId)?.color)?.name ||
    'session'
  const blocks = (global.userCreatedBlocks ?? []).length
  const islands = (global.userCreatedIslands ?? []).length
  const localBlocks = (local.userCreatedBlocks ?? []).length
  const localIslands = (local.userCreatedIslands ?? []).length
  const detail = [
    global.enabled ? `global ${blocks} file(s), ${islands} island(s)` : null,
    local.enabled
      ? `${colorName} ${localBlocks} file(s), ${localIslands} island(s)`
      : null,
  ]
    .filter(Boolean)
    .join('; ')
  printBlueprintDump(global)
  printBlueprintDump(local, { local: true, colorName })
  store.markBlueprintSeen(dataDir, sessionId, global.revision, local.revision)
  return {
    global,
    local,
    colorName,
    detail: detail || 'none',
  }
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

  const dumped = printSessionBlueprints(store, config.dataDir, sessionId)
  signalAck(
    store,
    config.dataDir,
    sessionId,
    'blueprint',
    dumped.detail,
  )
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
  const attached = store.contextFileHandshake(config.dataDir, sessionId)
  if (attached.files.length > 0) {
    console.log(
      'Honor the user\'s attached context files. Read each path with your file tools before planning. They are session-only attachments, not project files to create. Use any printed VISUAL_CODER_CONTEXT_FILE contents directly.',
    )
    console.log('VISUAL_CODER_CONTEXT_FILES_START')
    console.log(JSON.stringify(attached.files, null, 2))
    console.log('VISUAL_CODER_CONTEXT_FILES_END')
    for (const file of attached.texts) {
      console.log(`VISUAL_CODER_CONTEXT_FILE_START ${file.name}`)
      console.log(file.content)
      console.log('VISUAL_CODER_CONTEXT_FILE_END')
    }
  }
  const explain = await loadExplainStore()
  if (explain.readExplain(config.dataDir).pendingStart) {
    emitTargetExplain(store, explain, config.dataDir, sessionId)
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
      : `VISUAL_CODER_PLAN_READY Reported ${manifest.steps.length} plan step(s) for session ${sessionId}. Wait for the user to /go step ${manifest.currentStep}.`,
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

  const explain = await loadExplainStore()
  const { manifest: manifestPath } = store.sessionPaths(config.dataDir, sessionId)
  const explainFile = path.join(config.dataDir, explain.EXPLAIN_FILE)
  const gate = createManifestGate(manifestPath)
  const explainGate = createManifestGate(explainFile)
  let lastWaiting = null
  try {
    while (Date.now() - started < timeoutMs) {
      store.touchSessionConnection(config.dataDir, sessionId)
      store.autoAdvance(config.dataDir, sessionId, config.targetRoot)
      const manifest = store.readManifest(config.dataDir, sessionId)
      const pendingStart = explain.readExplain(config.dataDir).pendingStart
      emitApprovalHandshake(
        store,
        explain,
        config.dataDir,
        sessionId,
        manifest,
        initialDiff,
        pendingStart,
      )
      if (!manifest) continue
      const global = store.readBlueprint(config.dataDir)
      const local = store.readLocalBlueprint(config.dataDir, sessionId)
      const seenGlobal = manifest.blueprintRevision ?? 0
      const seenLocal = manifest.localBlueprintRevision ?? 0
      const globalChanged = global.revision > seenGlobal
      const localChanged = local.revision > seenLocal
      if (globalChanged || localChanged) {
        const dumped = printSessionBlueprints(store, config.dataDir, sessionId)
        const colorName = dumped.colorName
        signalAck(
          store,
          config.dataDir,
          sessionId,
          'blueprint',
          dumped.detail,
        )
        if (globalChanged && localChanged) {
          console.log(
            `VISUAL_CODER_BLUEPRINT The global blueprint and the ${colorName} session blueprint changed. Follow the latest files, islands, functions, variables, imports, and notes from both. Do not omit, rename, relocate, or replace them. The ${colorName} blueprint is only for this chat. If this would differ from the current plan, ask the user before replacing the plan. Then run wait-for-approval again.`,
          )
        } else if (localChanged) {
          console.log(
            `VISUAL_CODER_BLUEPRINT The ${colorName} session blueprint changed. This local blueprint is only for this chat. Follow its latest files, islands, functions, variables, imports, and notes together with the global blueprint. Do not omit, rename, relocate, or replace them. If this would differ from the current plan, ask the user before replacing the plan. Then run wait-for-approval again.`,
          )
        } else {
          console.log(
            'VISUAL_CODER_BLUEPRINT The global blueprint changed. Follow the latest files, islands, functions, variables, imports, and notes. Do not omit, rename, relocate, or replace them. If this would differ from the current plan, ask the user before replacing the plan. Then run wait-for-approval again.',
          )
        }
        process.exit(6)
      }
      const waiting = waitingMessage(sessionId, manifest)
      if (waiting !== lastWaiting) {
        console.log(waiting)
        lastWaiting = waiting
      }
      await Promise.race([gate.wait(50), explainGate.wait(50)])
    }
  } finally {
    gate.close()
    explainGate.close()
  }

  signalAck(store, config.dataDir, sessionId, 'timeout', 'no visualizer signal')
  store.stopSession(config.dataDir, sessionId, config.targetRoot)
  console.error('Timed out waiting for visualizer review. Do not modify files.')
  process.exit(3)
}

export async function goProposal(args) {
  const { store, config } = await loadExplorer()
  requireVisualizer(store, config)
  const sessionId = resolveCliSessionId(store, config.dataDir, args, 'go')
  const manifest = store.readManifest(config.dataDir, sessionId)
  if (!manifest) {
    console.error(`No workflow session found for ${sessionId}`)
    process.exit(1)
  }
  if (manifest.phase === 'review') {
    console.error('A proposal is waiting. Use /accept to accept it.')
    process.exit(1)
  }
  if (manifest.phase !== 'plan_ready') {
    console.error('Session is not waiting for /go.')
    process.exit(1)
  }
  let next
  try {
    next = store.invokeStep(
      config.dataDir,
      sessionId,
      manifest.currentStep,
      config.targetRoot,
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
  const explain = await loadExplainStore()
  emitApprovalHandshake(
    store,
    explain,
    config.dataDir,
    sessionId,
    next,
    null,
    null,
  )
}

export async function acceptProposal(args) {
  const { store, config } = await loadExplorer()
  requireVisualizer(store, config)
  const sessionId = resolveCliSessionId(store, config.dataDir, args, 'accept')
  const manifest = store.readManifest(config.dataDir, sessionId)
  if (!manifest) {
    console.error(`No workflow session found for ${sessionId}`)
    process.exit(1)
  }
  if (manifest.phase === 'plan_ready') {
    console.error('No proposal to accept. Use /go to start making it.')
    process.exit(1)
  }
  if (manifest.phase !== 'review') {
    console.error('Session is not waiting for /accept.')
    process.exit(1)
  }
  const active = manifest.diffs?.at(-1)
  if (!active || active.status !== 'pending') {
    console.error('No proposal to accept.')
    process.exit(1)
  }
  let next
  try {
    next =
      active.step >= manifest.steps.length
        ? store.continueDiff(
            config.dataDir,
            config.targetRoot,
            sessionId,
            active.id,
          )
        : store.invokeStep(
            config.dataDir,
            sessionId,
            active.step + 1,
            config.targetRoot,
          )
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
  const explain = await loadExplainStore()
  emitApprovalHandshake(
    store,
    explain,
    config.dataDir,
    sessionId,
    next,
    null,
    null,
  )
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
      `Cleared session ${sessionId}; stored diffs were removed. The global blueprint remains.`,
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
        ? `VISUAL_CODER_STEP_READY Recorded live edits as patch ${entry.id} for session ${sessionId}, step ${entry.step}/${manifest.steps.length}: ${parsed.files.length} changed, ${parsed.creates.length} added. Do not keep editing. Walk the diffs, then /accept to finish.`
        : `VISUAL_CODER_STEP_READY Recorded live edits as patch ${entry.id} for session ${sessionId}, step ${entry.step}/${manifest.steps.length}: ${parsed.files.length} changed, ${parsed.creates.length} added. Immediately run wait-for-approval. Do not explore or plan. /accept invokes the next step; when EXECUTE returns, implement that step at once.`,
  )
}

async function loadExplainStore() {
  const explainPath = pathToFileURL(
    path.join(explorerRoot, 'scripts/explain-store.mjs'),
  ).href
  return import(explainPath)
}

export async function runExplain(args) {
  const { store, config } = await loadExplorer()
  requireVisualizer(store, config)
  const explain = await loadExplainStore()
  const parsed = explain.parseExplainCli(args)
  if (parsed.action === 'stop') {
    explain.stopExplain(config.dataDir)
    console.log('VISUAL_CODER_EXPLAIN_STOPPED Explain mode is off.')
    return
  }
  if (parsed.action === 'wait') {
    await waitForExplain(store, explain, config.dataDir, args)
    return
  }
  if (parsed.action === 'start') {
    const proposal = readProposalInfo(store, config.dataDir)
    const question =
      parsed.question ||
      (proposal ? `Explain the current proposal: ${proposal.title}` : '')
    if (!question) {
      usage('explain start', '--question "How does this work?"')
    }
    explain.startExplain(config.dataDir, question)
    store.clearPendingExplain(config.dataDir)
    store.touchExplainConnections(config.dataDir)
    if (proposal) {
      console.log(
        `VISUAL_CODER_PROPOSAL Explain the current proposal for step ${proposal.step}: ${proposal.title}. The user asked: ${question}. Do not edit project files. Walk this proposal on the map.`,
      )
    }
    console.log(`VISUAL_CODER_EXPLAIN_STARTED ${question}`)
    console.log(
      'The map is in explain mode. Explore the codebase, then run inbase explain report with --step / --body / --files / --folders / --select / --zoom / --relations / --info / --highlight / --point.',
    )
    return
  }
  if (!parsed.steps.length) {
    usage(
      'explain report',
      '--question "How does this work?" --step "Title" --body "..." --files path [--folders path] [--select path] [--zoom path] [--relations from:to] [--info] [--highlight function:name] [--point function:name] [--parent 7]',
    )
  }
  const next = explain.reportExplain(config.dataDir, {
    question: parsed.question,
    parent: parsed.parent,
    steps: parsed.steps,
  })
  store.touchExplainConnections(config.dataDir)
  if (parsed.parent) {
    const added = next.steps.filter((step) =>
      explain.isExplainDescendant(step.index, parsed.parent),
    ).length
    console.log(
      `VISUAL_CODER_EXPLAIN_READY Reported ${added} follow-up step(s) under ${parsed.parent} for "${parsed.question || next.question}". Walk ${parsed.parent}.1 … then continue at the next parent step.`,
    )
  } else {
    console.log(
      `VISUAL_CODER_EXPLAIN_READY Reported ${next.steps.length} explanation step(s) for "${next.question}". The visualizer shows them; the user navigates. Do not walk the map or change the current step.`,
    )
  }
  console.log(
    'Run inbase explain wait for a question about the current step, or until the user exits.',
  )
}

async function waitForExplain(store, explain, dataDir, args) {
  const timeoutMs = Number(takeFlagValue(args, '--timeout') ?? 600000)
  const started = Date.now()
  const explainFile = path.join(dataDir, explain.EXPLAIN_FILE)
  const gate = createManifestGate(explainFile)
  let lastWaiting = null
  try {
    while (Date.now() - started < timeoutMs) {
      store.touchExplainConnections(dataDir)
      const current = explain.readExplain(dataDir)
      if (!current.active) {
        printAck('stopped', 'explain mode was closed')
        console.log(
          'VISUAL_CODER_EXPLAIN_STOPPED The user exited explain mode. Do not report more steps.',
        )
        process.exit(2)
      }
      if (current.pendingStart) {
        const request = explain.consumeExplainStart(dataDir)
        if (!request) continue
        const quoted = JSON.stringify(request.question)
        printAck('explain', explain.explainTargetLabel(request))
        console.log(
          `VISUAL_CODER_EXPLAIN The user clicked Explain on the ${explain.explainTargetLabel(request)}. Replace the current explanation. Do not edit project files. Do not report sub-steps. Do not start the map walk overlay. The visualizer shows a single-explanation card. Run: npx inbase explain start --question ${quoted} Then inspect that ${request.kind} and where it fits in the codebase, and report one explanation with npx inbase explain report --question ${quoted} --step "..." --body "...". Use a single --step. Then run npx inbase explain wait again.`,
        )
        process.exit(0)
      }
      if (current.pendingQuestion && !current.answering) {
        const asked = explain.consumeExplainQuestion(dataDir)
        if (!asked) continue
        const insertParent = asked.parent
        const aboutId = asked.from && asked.from !== asked.parent ? asked.from : asked.parent
        const about =
          current.steps.find((step) => step.index === aboutId) ??
          current.steps.find((step) => step.index === insertParent)
        const title = asked.fromTitle || about?.title || `step ${aboutId}`
        printAck('question', `step ${aboutId}`)
        console.log(
          `VISUAL_CODER_EXPLAIN_QUESTION The user asked about step ${aboutId}: ${title}. Do not replace the whole explanation. Report one-level sub-steps under ${insertParent} with --parent "${insertParent}". This replaces any current sub-steps. Do not nest further (no ${insertParent}.1.1).`,
        )
        console.log(`VISUAL_CODER_PARENT ${insertParent}`)
        console.log(`VISUAL_CODER_INSTRUCTION_START\n${asked.question}\nVISUAL_CODER_INSTRUCTION_END`)
        console.log(
          `Run: npx inbase explain report --parent "${insertParent}" --question ${JSON.stringify(asked.question)} --step "..." --body "..." --files path [--folders path] [--select path] [--zoom path] [--relations from:to] [--info] [--highlight function:name] [--point function:name]. Repeat --step for ${insertParent}.1, ${insertParent}.2, … Then run npx inbase explain wait again.`,
        )
        process.exit(0)
      }
      const waiting = 'Waiting for a question on an explanation step...'
      if (waiting !== lastWaiting) {
        console.log(waiting)
        lastWaiting = waiting
      }
      await gate.wait(50)
    }
  } finally {
    gate.close()
  }

  printAck('timeout', 'no explain question')
  console.error(
    'Timed out waiting for an explain question. Do not report more steps.',
  )
  process.exit(3)
}
