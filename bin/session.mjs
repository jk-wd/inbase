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

function signalAck(store, dataDir, sessionId, kind, detail) {
  printAck(kind, detail)
  try {
    store.recordSessionAck(dataDir, sessionId, kind, detail)
  } catch {
    // Session folder may already be gone.
  }
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

function emitApprovalHandshake(store, dataDir, sessionId, manifest) {
  manifest = store.readManifest(dataDir, sessionId) ?? manifest
  if (!manifest || manifest.phase === 'stopped') {
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
        ? `VISUAL_CODER_EXECUTE Step ${manifest.currentStep} is invoked${title ? `: ${title}` : ''}. Continue immediately: edit live files for this step only, then inbase propose-patch --session ${sessionId} with no patch file. Then stop and wait for the user to /go in chat.`
        : `VISUAL_CODER_EXECUTE Step ${manifest.currentStep} is invoked${title ? `: ${title}` : ''}. Re-read the global blueprint.json and this session's local blueprint before implementing; the user can place files and islands at any time. Edit the live project files for this step only (Write, StrReplace, Delete). Then record the step with inbase propose-patch --session ${sessionId} — no patch file. Then stop and wait for the user to /go in chat.`,
    )
    process.exit(0)
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
      ? `VISUAL_CODER_ATTACHED Attached to the ${colorName} session (${manifest.phase}). Tell the user you connected to the ${colorName} chat. Use --session ${manifest.sessionId} for every later command. Run inbase wait-for-blueprint --session ${manifest.sessionId} to read the optional blueprint, instruction, and attached files; it does not wait. Then report a plan if you can. Stop after report-plan — the user types /go or /explain in chat.`
      : `VISUAL_CODER_ATTACHED Attached to the next waiting visualizer session ${manifest.name || manifest.sessionId} (${manifest.phase}). Use --session ${manifest.sessionId} for every later command. Run inbase wait-for-blueprint --session ${manifest.sessionId} to read the optional blueprint, instruction, and attached files; it does not wait. Then report a plan if you can. Stop after report-plan — the user types /go or /explain in chat.`,
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
      : `VISUAL_CODER_PLAN_READY Reported ${manifest.steps.length} plan step(s) for session ${sessionId}. Stop. Wait for the user to type /go step ${manifest.currentStep} in chat.`,
  )
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
  let next
  try {
    if (manifest.phase === 'review') {
      const active = manifest.diffs?.at(-1)
      if (!active || active.status !== 'pending') {
        console.error('No proposal to continue.')
        process.exit(1)
      }
      next = store.continueDiff(
        config.dataDir,
        config.targetRoot,
        sessionId,
        active.id,
      )
    } else if (manifest.phase === 'plan_ready') {
      next = store.invokeStep(
        config.dataDir,
        sessionId,
        manifest.currentStep,
        config.targetRoot,
      )
    } else {
      console.error('Session is not waiting for /go.')
      process.exit(1)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
  if (next?.phase === 'plan_ready') {
    const step = next.currentStep
    const title = next.steps.find((item) => item.index === step)?.title
    signalAck(
      store,
      config.dataDir,
      sessionId,
      'plan',
      title
        ? `waiting for /go on step ${step} — ${title}`
        : `waiting for /go on step ${step}`,
    )
    console.log(
      `VISUAL_CODER_ACCEPTED Accepted the proposal. Stop. Wait for the user to type /go step ${step}${title ? `: ${title}` : ''} in chat. Do not edit files. The user can still Stop.`,
    )
    process.exit(0)
  }
  emitApprovalHandshake(store, config.dataDir, sessionId, next)
}

export async function acceptProposal(args) {
  return goProposal(args)
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
      ? `VISUAL_CODER_STEP_READY Recorded live edits as patch ${entry.id} for session ${sessionId}, step ${entry.step}/${manifest.steps.length}: ${parsed.files.length} changed, ${parsed.creates.length} added. Step by step is off, so the next step is already invoked. Implement that step now, then propose-patch again.`
      : last
        ? `VISUAL_CODER_STEP_READY Recorded live edits as patch ${entry.id} for session ${sessionId}, step ${entry.step}/${manifest.steps.length}: ${parsed.files.length} changed, ${parsed.creates.length} added. Stop. Wait for the user to type /go in chat to finish.`
        : `VISUAL_CODER_STEP_READY Recorded live edits as patch ${entry.id} for session ${sessionId}, step ${entry.step}/${manifest.steps.length}: ${parsed.files.length} changed, ${parsed.creates.length} added. Stop. Wait for the user to type /go in chat.`,
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
    console.error(
      'explain wait was removed. The user types /explain in chat for a follow-up or a map ? click.',
    )
    process.exit(1)
  }
  if (parsed.action === 'start') {
    const current = explain.readExplain(config.dataDir)
    if (current.active && current.steps.length > 0 && parsed.question) {
      const parent = explain.topLevelExplainStepId(current.currentStep)
      printAck('question', `step ${current.currentStep}`)
      console.log(
        `VISUAL_CODER_EXPLAIN_FOLLOWUP The user asked about the current explanation. Do not replace the whole explanation. Report one-level sub-steps under ${parent} with --parent "${parent}". This replaces any current sub-steps. Do not nest further (no ${parent}.1.1).`,
      )
      console.log(`VISUAL_CODER_PARENT ${parent}`)
      console.log(
        `VISUAL_CODER_INSTRUCTION_START\n${parsed.question}\nVISUAL_CODER_INSTRUCTION_END`,
      )
      console.log(
        `Run: npx inbase explain report --parent "${parent}" --question ${JSON.stringify(parsed.question)} --step "..." --body "..." --files path [--folders path] [--select path] [--zoom path] [--relations from:to] [--info] [--highlight function:name] [--point function:name]. Repeat --step for ${parent}.1, ${parent}.2, … Then stop. Wait for /explain or /go in chat.`,
      )
      return
    }
    const pending = current.pendingStart
    const proposal = readProposalInfo(store, config.dataDir)
    const question =
      parsed.question ||
      pending?.question ||
      (proposal ? `Explain the current proposal: ${proposal.title}` : '')
    if (!question) {
      usage('explain start', '--question "How does this work?"')
    }
    if (pending) {
      printAck('explain', explain.explainTargetLabel(pending))
      console.log(
        `VISUAL_CODER_EXPLAIN The user clicked Explain on the ${explain.explainTargetLabel(pending)}. Do not edit project files. The visualizer shows a single-explanation card. Inspect that ${pending.kind} and report one explanation with a single --step.`,
      )
    }
    explain.startExplain(config.dataDir, question)
    store.clearPendingExplain(config.dataDir)
    store.touchExplainConnections(config.dataDir)
    if (proposal && !pending) {
      console.log(
        `VISUAL_CODER_PROPOSAL Explain the current proposal for step ${proposal.step}: ${proposal.title}. The user asked: ${question}. Do not edit project files. Walk this proposal on the map.`,
      )
    }
    console.log(`VISUAL_CODER_EXPLAIN_STARTED ${question}`)
    console.log(
      'The map is in explain mode. Explore the codebase, then run inbase explain report with --step / --body / --files / --folders / --select / --zoom / --relations / --info / --highlight / --point. After reporting, stop. Wait for /explain or /go in chat.',
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
    'Stop. Wait for the user to type /explain in chat for a follow-up, or /go to continue the plan.',
  )
}
