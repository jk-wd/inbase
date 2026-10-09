import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { explorerRoot, instanceFile, readInstanceFile, takeFlagValue, takeFlagValues } from './project.mjs'
import { parseChangeNoteFlags } from '../apps/explorer/scripts/change-notes.mjs'

async function loadExplorer() {
  const storePath = pathToFileURL(
    path.join(explorerRoot, 'scripts/session-store.mjs'),
  ).href
  const configPath = pathToFileURL(
    path.join(explorerRoot, 'scripts/target-config.mjs'),
  ).href
  const [store, config] = await Promise.all([
    import(storePath),
    import(configPath),
  ])
  return { store, config }
}

function usage(name, example) {
  console.error(`Usage: inbase ${name} ${example}`)
  process.exit(1)
}

function printAck(kind, detail) {
  console.log(`VISUAL_CODER_ACK ${kind}: ${detail}`)
}

function executeStepHint(sessionId, stepId = null) {
  const stepFlag = stepId ? ` --step ${stepId}` : ''
  return `Edit live files for THIS invoked step only, ${proposePatchHint(sessionId, stepFlag)} Do not implement later steps first. After propose-patch, if the next step is invoked, repeat for that step only.`
}

function proposePatchHint(sessionId, stepFlag = '') {
  return `then MUST inbase propose-patch --session ${sessionId}${stepFlag} with --note "path: one-line goal" for each changed file and folder. No patch file.`
}

function stepIdOf(step) {
  if (!step || typeof step !== 'object') return ''
  if (typeof step.id === 'string' && step.id.trim()) return step.id.trim()
  return Number.isInteger(step.index) ? String(step.index) : ''
}

function currentPlanSteps(manifest) {
  const ids = Array.isArray(manifest?.currentStepIds) ? manifest.currentStepIds : []
  const steps = manifest?.steps ?? []
  if (ids.length > 0) {
    return ids
      .map((id) => steps.find((step) => stepIdOf(step) === String(id)))
      .filter(Boolean)
  }
  const current = steps.find((step) => step.index === manifest.currentStep)
  return current ? [current] : []
}

function formatExecute(manifest, sessionId, options = {}) {
  const current = currentPlanSteps(manifest)
  const continuing = options.continuing === true
  const tail = continuing
    ? 'Continue immediately. Do not stop.'
    : 'Do not stop until after the last recorded step.'
  const reread = continuing
    ? ''
    : ' Re-read this session\'s blueprint before implementing; the user can place files and folders at any time.'
  const step = current[0]
  const id = stepIdOf(step) || String(manifest.currentStep)
  const title = step?.title
  return `VISUAL_CODER_EXECUTE Step ${id} is invoked${title ? `: ${title}` : ''}.${reread} ${executeStepHint(sessionId, id)} ${tail}`
}

const EXPLAIN_BODY_HINT =
  'Write each --body for a mid-level teammate: short readable paragraphs, name the functions, no telegraphic colon-lists. Repeat --body for each paragraph. Prefer more text over a compressed one-liner.'

const EXPLAIN_LIST_HINT =
  'Call explain report ONCE. Repeat --step in that same command for every file or topic so they stack on the map (1, 2, 3, …). Do not call explain report once per step — each report replaces the list, so only the last step would stay visible. A map ? click is the exception: one --step.'

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
  const raw = takeFlagValue(args, '--session') || store.readActiveSession(dataDir)
  if (!raw) usage(command, '[--session <color>]')
  return resolveFlagSession(store, raw)
}

function resolveFlagSession(store, raw) {
  try {
    return store.resolveSessionId(raw)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
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
  if (manifest.phase === 'plan_ready' || manifest.phase === 'working') {
    const step = manifest.currentStep
    const title =
      manifest.steps?.find((item) => item.index === step)?.title || `step ${step}`
    return { phase: manifest.phase, step, title, sessionId: manifest.sessionId }
  }
  return null
}

function readProposalInfo(store, dataDir, sessionId = null) {
  const id = sessionId || store.readActiveSession(dataDir)
  if (!id) return null
  return proposalInfo(store.readManifest(dataDir, id))
}

function readKnownFileIds(dataDir) {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'codebase.json'), 'utf8'),
    )
    return Array.isArray(parsed?.files)
      ? parsed.files
          .map((file) => file?.id)
          .filter((id) => typeof id === 'string' && id)
      : []
  } catch {
    return []
  }
}

function readUserContext(dataDir) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(dataDir, 'user-context.json'), 'utf8'),
    )
  } catch {
    return null
  }
}

function readShowBranchChanges(dataDir) {
  return readUserContext(dataDir)?.showBranchChanges === true
}

function llmHidesBranchChanges(intent) {
  if (!intent || intent.awaitingAttach) return false
  return (
    intent.working ||
    intent.preview ||
    intent.status === 'preparing' ||
    intent.status === 'working' ||
    intent.status === 'replanning' ||
    intent.status === 'pending' ||
    intent.status === 'extend' ||
    intent.status === 'extended'
  )
}

function changeSummary(source) {
  return {
    files: source?.files ?? [],
    creates: source?.creates ?? [],
    deletes: source?.deletes ?? [],
    createFolders: source?.createFolders ?? [],
    addedFunctions: source?.addedFunctions ?? [],
    addedVariables: source?.addedVariables ?? [],
    addedImports: source?.addedImports ?? [],
    changedFunctions: source?.changedFunctions ?? [],
    changedVariables: source?.changedVariables ?? [],
    imports: source?.imports ?? [],
  }
}

function hasChangeSummary(summary) {
  return (
    summary.files.length > 0 ||
    summary.creates.length > 0 ||
    summary.deletes.length > 0
  )
}

function printChangeSummary(summary) {
  console.log('VISUAL_CODER_CHANGES_START')
  console.log(JSON.stringify(summary, null, 2))
  console.log('VISUAL_CODER_CHANGES_END')
}

async function readVisibleChanges(store, config) {
  const dataDir = config.dataDir
  const known = readKnownFileIds(dataDir)
  const intents = store.listSessionIntents(dataDir, known, config.targetRoot)
  const llmOverlay = intents.find((intent) => llmHidesBranchChanges(intent))
  if (readShowBranchChanges(dataDir) && !llmOverlay) {
    const branchMod = await import(
      pathToFileURL(path.join(explorerRoot, 'scripts/branch-changes.mjs')).href
    )
    const context = readUserContext(dataDir)
    const branch = branchMod.readBranchChanges(
      config.targetRoot,
      known,
      context?.branchChangesBase,
    )
    if (branch.available) {
      const commit = Array.isArray(branch.commits)
        ? branch.commits.find((item) => item?.sha === branch.base)
        : null
      const vs =
        branch.current && branch.branch
          ? ` (${branch.branch} vs last commit)`
          : commit && branch.branch
            ? ` (${branch.branch} vs ${commit.short})`
            : branch.branch && branch.base
              ? ` (${branch.branch} vs ${branch.base})`
              : ''
      return {
        kind: 'diff',
        question: 'What has changed in this diff?',
        headline: `What has changed in this git diff${vs}`,
        summary: changeSummary(branch),
      }
    }
  }
  const sessionId = store.readActiveSession(dataDir)
  const intent =
    (sessionId &&
      store.sessionIntent(
        dataDir,
        sessionId,
        known,
        undefined,
        undefined,
        config.targetRoot,
      )) ||
    llmOverlay ||
    null
  if (!intent?.preview) return null
  const summary = changeSummary(intent)
  if (!hasChangeSummary(summary)) return null
  const selected =
    intent.chainIndex != null ? intent.chain?.[intent.chainIndex] : null
  const title =
    selected?.title || intent.reason || intent.feature || 'this proposal'
  const stepNo = selected?.step ?? intent.step
  const step = stepNo != null ? ` for step ${stepNo}` : ''
  return {
    kind: 'proposal',
    question: 'What has changed in this proposal?',
    headline: `What has changed in this proposal${step}: ${title}`,
    summary,
  }
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
      `VISUAL_CODER_FINISHED The final step was applied. Feature is done. Tell the user it is finished. Do not restore or revert project files.`,
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
      formatExecute(manifest, sessionId, {
        continuing,
      }),
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
    usage('start-session', '--session <color> --name "short name"')
  }

  const manifest = store.startSession(config.dataDir, {
    sessionId: resolveFlagSession(store, sessionId),
    name,
    feature,
  })
  console.log(
    `VISUAL_CODER_BLUEPRINT_WAIT Session ${manifest.name || sessionId} is visible in the visualizer (${manifest.phase}). Run inbase read-blueprint before reporting a plan. A running visualizer does not skip this handshake.`,
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
  const first = args.includes('--first')
  const before = sessionId ? store.readManifest(config.dataDir, sessionId) : null
  const alreadyAttached = Boolean(before) && before.awaitingAttach === false
  const manifest = store.attachSession(config.dataDir, sessionId, {
    color: colorQuery,
    first,
    targetRoot: config.targetRoot,
  })
  const color = store.resolveSessionColor(manifest.color)
  const colorName = color?.name || null
  console.log(`VISUAL_CODER_SESSION ${manifest.sessionId}`)
  if (colorName) console.log(`VISUAL_CODER_COLOR ${colorName}`)
  if (alreadyAttached) {
    console.log(
      `VISUAL_CODER_ALREADY_ATTACHED Already attached to the ${colorName || 'current'} session (${manifest.phase}). Stay in this session. Do not run npx inbase attach without --session — that locks a different color. Use --session ${manifest.sessionId} for every later command. A change request, including after the last proposal, must report-plan with the new remaining steps from the last proposal. That replaces the waiting step. Then implement. Do not say you are connecting to a new chat. Do not start a new plan from read-blueprint.`,
    )
    return
  }
  printAck('attached', colorName || manifest.name || manifest.sessionId)
  const wrongSlot =
    ' If this conversation already printed VISUAL_CODER_SESSION, this is the wrong slot: stop, stay on the original color, and use that --session. Do not report a new plan here.'
  console.log(
    colorName
      ? `VISUAL_CODER_ATTACHED Attached to the ${colorName} session (${manifest.phase}). Tell the user you connected to the ${colorName} chat. Use --session ${manifest.sessionId} for every later command. Run inbase read-blueprint --session ${manifest.sessionId} to load the optional blueprint, instruction, and attached files. Then say what you see on the blueprint in chat (I see on the blueprint ...). Then you MUST run report-plan with --steps for the full implementation, using sequential steps (1, 2, 3). Do not spawn subagents. Do not edit any files before report-plan. After report-plan, implement the invoked step only, then MUST propose-patch. Repeat that loop for each later invoked step. Never implement the whole plan before propose-patch. After the last recorded step, MUST inbase finish --session ${manifest.sessionId}.${wrongSlot}`
      : `VISUAL_CODER_ATTACHED Attached to the next waiting visualizer session ${manifest.name || manifest.sessionId} (${manifest.phase}). Use --session ${manifest.sessionId} for every later command. Run inbase read-blueprint --session ${manifest.sessionId} to load the optional blueprint, instruction, and attached files. Then say what you see on the blueprint in chat (I see on the blueprint ...). Then you MUST run report-plan with --steps for the full implementation, using sequential steps (1, 2, 3). Do not spawn subagents. Do not edit any files before report-plan. After report-plan, implement the invoked step only, then MUST propose-patch. Repeat that loop for each later invoked step. Never implement the whole plan before propose-patch. After the last recorded step, MUST inbase finish --session ${manifest.sessionId}.${wrongSlot}`,
  )
}

function printBlueprintDump(blueprint, options = {}) {
  const files = blueprint.files ?? []
  const folders = blueprint.folders ?? []
  const deleted = blueprint.deleted ?? []
  const steps = blueprint.steps ?? []
  const colorName = options.colorName || 'session'
  if (blueprint.enabled) {
    const deletedHint =
      deleted.length > 0
        ? ` Delete the ${deleted.length} file(s) in the deleted list (they are file paths or ids: remove them and drop imports, references, and usages of them).`
        : ''
    const stepsHint =
      steps.length > 0
        ? ' The steps list is the exception: it holds suggestions, not requirements.'
        : ''
    console.log(
      `VISUAL_CODER_BLUEPRINT_READY The ${colorName} blueprint has ${files.length} file(s), ${folders.length} folder(s), ${deleted.length} deleted file(s), and ${steps.length} suggested step(s). This blueprint is only for this ${colorName} chat and is leading: follow it as closely as possible. Create those paths and honor classes, functions, variables, imports, and notes even if they are not on disk.${deletedHint} Do not omit, rename, relocate, or replace them. Extra new files not in this blueprint are allowed when needed if the blueprint does not cover them.${stepsHint}`,
    )
    if (steps.length > 0) {
      console.log(
        `VISUAL_CODER_BLUEPRINT_STEPS The ${colorName} blueprint suggests ${steps.length} step(s) in "steps". They are suggestions from the user or an earlier proposal, not the plan. Decide yourself which ones are useful and relevant for this blueprint and request, and in what order. Keep, merge, split, reword, reorder, or drop them, and add missing steps. Then report-plan your own sequential steps (1, 2, 3).`,
      )
    }
  } else {
    console.log(
      `VISUAL_CODER_BLUEPRINT_READY The ${colorName} blueprint is empty. The user can still place files and folders on this color; re-read the blueprint when it is printed again. Continue without user-placed files until that dump has content.`,
    )
  }
  console.log('VISUAL_CODER_BLUEPRINT_START')
  console.log(JSON.stringify(blueprint, null, 2))
  console.log('VISUAL_CODER_BLUEPRINT_END')
}

function printSessionScope(store, dataDir, sessionId) {
  const color = store.resolveSessionColor(
    store.readManifest(dataDir, sessionId)?.color,
  )
  const colorName = color?.name || 'session'
  const colorId = color?.id || sessionId
  console.log(
    `VISUAL_CODER_SESSION_SCOPE This chat implements only this ${colorName} blueprint. Plan sequential steps (1, 2, 3) for this color only. Report only with --session ${colorId}. Do not spawn subagents.`,
  )
}

function printSessionBlueprints(store, dataDir, sessionId) {
  const local = store.readLocalBlueprint(dataDir, sessionId)
  const colorName =
    store.resolveSessionColor(store.readManifest(dataDir, sessionId)?.color)?.name ||
    'session'
  const files = (local.files ?? []).length
  const folders = (local.folders ?? []).length
  const detail = local.enabled
    ? `${colorName} ${files} file(s), ${folders} folder(s)`
    : null
  printBlueprintDump(local, { colorName })
  printSessionScope(store, dataDir, sessionId)
  console.log(
    'VISUAL_CODER_SAY_BLUEPRINT Reply in chat now. Start with "I see on the blueprint" and name every file, folder, class, function, variable, import, note, pointer, deleted file, and suggested step from this color\'s dump. This confirms you interpreted the blueprint correctly. Then, unless you were told to stop and wait, you MUST run report-plan with --steps for the full implementation, using sequential steps (1, 2, 3). Do not spawn subagents. Do not edit files yet. Do not list steps in chat — report-plan is the plan. If the dump is empty, say "I see nothing on the blueprint yet."',
  )
  store.markBlueprintSeen(dataDir, sessionId, local.revision, local.revision)
  return {
    global: local,
    local,
    colorName,
    detail: detail || 'none',
  }
}

export async function readBlueprint(args) {
  const { store, config } = await loadExplorer()
  const raw = takeFlagValue(args, '--session')
  if (!raw) usage('read-blueprint', '--session <color>')
  const sessionId = resolveFlagSession(store, raw)

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
  } else if (dumped.local.enabled) {
    console.log(
      'VISUAL_CODER_BLUEPRINT_ONLY No chat instruction. An enabled blueprint is the request: MUST run report-plan with --steps for the full implementation, then implement as closely as possible. Ask the user if you need more information before reporting the plan. Extra files are allowed if the blueprint does not cover them. Do not edit before report-plan.',
    )
  } else {
    console.log(
      'VISUAL_CODER_NO_REQUEST No chat instruction and no enabled blueprint. Stop. Wait for the user to type a request or /explainit in chat.',
    )
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
    ? resolveFlagSession(store, sessionParsed.values[0])
    : null
  const existing = sessionId ? store.readManifest(config.dataDir, sessionId) : null
  const feature = featureParsed.values[0] ?? existing?.feature

  if (!sessionId || !feature || stepsParsed.values.length === 0) {
    usage(
      'report-plan',
      '--session <color> --feature "name" --steps "one" [--steps "two"]',
    )
  }

  const manifest = store.reportPlan(config.dataDir, {
    sessionId,
    feature,
    stepTitles: stepsParsed.values,
    targetRoot: config.targetRoot,
    maxSubagents: 1,
  })
  const replacedWaiting = manifest.diffs.some((entry) => entry.status === 'extend')
  if (replacedWaiting && manifest.phase === 'working') {
    const startAt = manifest.currentStep
    const kept = manifest.steps.filter((step) => step.index < startAt)
    const remaining = manifest.steps.filter((step) => step.index >= startAt)
    const keptLabel =
      kept.length === 0
        ? ''
        : kept.length === 1
          ? `Kept step ${stepIdOf(kept[0]) || kept[0].index}. `
          : `Kept steps ${stepIdOf(kept[0]) || kept[0].index}–${stepIdOf(kept.at(-1)) || kept.at(-1).index}. `
    const remainingList = remaining
      .map((step) => `${stepIdOf(step) || step.index}. ${step.title}`)
      .join('; ')
    console.log(
      `VISUAL_CODER_PLAN_READY Revised the plan for session ${sessionId} from step ${stepIdOf(remaining[0]) || startAt}. ${keptLabel}New remaining steps: ${remainingList}. Replaced the waiting proposal with the new remaining steps. Do not ask the user to close the session. Do not edit files before this report-plan.`,
    )
    console.log(formatExecute(manifest, sessionId))
    return
  }
  console.log(
    `VISUAL_CODER_PLAN_READY Reported ${manifest.steps.length} plan step(s) for session ${sessionId}.`,
  )
  if (manifest.phase === 'working') {
    console.log(formatExecute(manifest, sessionId))
  }
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
      console.error('Session is not waiting for a proposal.')
      process.exit(1)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
  if (next?.phase === 'plan_ready') {
    next = store.autoAdvance(
      config.dataDir,
      sessionId,
      config.targetRoot,
    )
  }
  emitApprovalHandshake(store, config.dataDir, sessionId, next)
}

export async function acceptProposal(args) {
  const { store, config } = await loadExplorer()
  requireVisualizer(store, config)
  const sessionId = resolveCliSessionId(store, config.dataDir, args, 'accept')
  store.completeSession(config.dataDir, sessionId, config.targetRoot)
  printAck('finished', 'session completed')
  console.log(
    `VISUAL_CODER_FINISHED Session ${sessionId} is done. Applied files were kept. The color slot is free. Do not restore or revert project files. Do not attach again in this conversation.`,
  )
  process.exit(5)
}

export async function finishWorkflow(args) {
  const { store, config } = await loadExplorer()
  requireVisualizer(store, config)
  const sessionId = resolveCliSessionId(store, config.dataDir, args, 'finish')
  store.finishSession(config.dataDir, sessionId, config.targetRoot)
  printAck('finished', 'session finished')
  console.log(
    `VISUAL_CODER_FINISHED Session ${sessionId} is finished. Applied files were kept. The blueprint stayed. The session window stays until the user clicks Done. Do not restore or revert project files. Do not attach again in this conversation.`,
  )
}

export async function proposePatch(args) {
  const { store, config } = await loadExplorer()
  const clear = args.includes('--clear')
  const withoutClear = args.filter((arg) => arg !== '--clear')
  const sessionParsed = takeFlagValues(withoutClear, '--session')
  const noteParsed = takeFlagValues(sessionParsed.rest, '--note')
  const stepParsed = takeFlagValues(noteParsed.rest, '--step')
  const extra = stepParsed.rest[0]
  const sessionId = sessionParsed.values[0]
    ? resolveFlagSession(store, sessionParsed.values[0])
    : null

  if (clear) {
    if (!sessionId) usage('propose-patch', '--session <color> --clear')
    store.finalizeFinishedSession(
      config.dataDir,
      sessionId,
      config.targetRoot,
    )
    console.log(
      `Cleared session ${sessionId}; stored diffs were removed. Applied files were kept.`,
    )
    process.exit(0)
  }

  if (!sessionId || extra) {
    usage('propose-patch', '--session <color> [--step <id>] [--note "path: summary"]')
  }

  let recorded
  try {
    recorded = store.appendDiff(config.dataDir, config.targetRoot, {
      sessionId,
      changeNotes: parseChangeNoteFlags(noteParsed.values),
      step: stepParsed.values[0],
      maxSubagents: 1,
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
  const { entry, manifest } = recorded
  const overlay = store.readOverlay(config.dataDir, sessionId, entry)
  const recordedId = entry.stepId || String(entry.step)

  if (manifest.phase === 'working') {
    signalAck(
      store,
      config.dataDir,
      sessionId,
      'execute',
      currentPlanSteps(manifest)
        .map((step) =>
          step.title ? `${stepIdOf(step)} — ${step.title}` : stepIdOf(step),
        )
        .join('; '),
    )
    console.log(
      `VISUAL_CODER_STEP_READY Recorded the current map overlay as ${entry.id} for session ${sessionId}, step ${recordedId}: ${overlay.files.length} changed, ${overlay.creates.length} added. The next step is already invoked. Implement that next plan step only, then MUST propose-patch again before any later step. Do not stop. Do not ask the user to review this step.`,
    )
    console.log(formatExecute(manifest, sessionId, { continuing: true }))
    return
  }

  console.log(
    `VISUAL_CODER_STEP_READY Recorded the current map overlay as ${entry.id} for session ${sessionId}, step ${entry.step}/${manifest.steps.length}: ${overlay.files.length} changed, ${overlay.creates.length} added. That was the last plan step. MUST inbase finish --session ${sessionId}. That marks the session finished and keeps applied files and the blueprint. The user clicks Done in the session window to clear it. Then stop. A change request before finish must report-plan with the new remaining steps first — that replaces this proposal from step ${entry.step}. Do not edit files before report-plan.`,
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
      'explain wait was removed. The user types /explainit in chat for a follow-up or a map ? click.',
    )
    process.exit(1)
  }
  if (parsed.action === 'start') {
    const current = explain.readExplain(config.dataDir)
    if (current.active && current.steps.length > 0 && parsed.question) {
      const parent = current.currentStep
      explain.askExplainQuestion(config.dataDir, parent, parsed.question)
      printAck('question', `step ${parent}`)
      console.log(
        `VISUAL_CODER_EXPLAIN_FOLLOWUP The user asked about the current explanation. Do not replace the whole explanation. Report ALL sub-steps under ${parent} in ONE explain report with --parent "${parent}". This replaces any current sub-steps of ${parent}. Nested follow-ups are allowed: ${parent}.1, ${parent}.1.1, ${parent}.1.1.1, and so on.`,
      )
      console.log(`VISUAL_CODER_PARENT ${parent}`)
      console.log(
        `VISUAL_CODER_INSTRUCTION_START\n${parsed.question}\nVISUAL_CODER_INSTRUCTION_END`,
      )
      console.log(
        `Run: npx inbase explain report --parent "${parent}" --question ${JSON.stringify(parsed.question)} --step "..." --body "..." --files path [--folders path] [--select path] [--zoom path] [--relations from:to] [--info] [--highlight function:name] [--point function:name]. Repeat --step in that SAME command for every child (${parent}.1, ${parent}.2, …). Do not call explain report once per sub-step — that replaces the children of ${parent}. Repeat --body for each paragraph. Then stop. Wait for /explainit in chat.`,
      )
      console.log(EXPLAIN_BODY_HINT)
      return
    }
    const pending = current.pendingStart
    const visible = pending ? null : await readVisibleChanges(store, config)
    const proposal = pending || visible ? null : readProposalInfo(store, config.dataDir)
    const question =
      parsed.question ||
      pending?.question ||
      visible?.question ||
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
    if (visible?.kind === 'diff') {
      const asked = parsed.question
        ? ` The user asked: ${parsed.question}.`
        : ''
      console.log(
        `VISUAL_CODER_DIFF ${visible.headline}.${asked} Do not edit project files. Walk the added, updated, and removed files on the map.`,
      )
      printChangeSummary(visible.summary)
    } else if (visible?.kind === 'proposal') {
      const asked = parsed.question
        ? ` The user asked: ${parsed.question}.`
        : ''
      console.log(
        `VISUAL_CODER_PROPOSAL ${visible.headline}.${asked} Do not edit project files. Walk these changes on the map.`,
      )
      printChangeSummary(visible.summary)
    } else if (proposal) {
      console.log(
        `VISUAL_CODER_PROPOSAL Explain the current proposal for step ${proposal.step}: ${proposal.title}. The user asked: ${question}. Do not edit project files. Walk this proposal on the map.`,
      )
    }
    console.log(`VISUAL_CODER_EXPLAIN_STARTED ${question}`)
    console.log(
      `The map is in explain mode. Explore the codebase, then run ONE inbase explain report with --step / --body / --files / --folders / --select / --zoom / --relations / --info / --highlight / --point. ${EXPLAIN_LIST_HINT} Repeat --body for each paragraph. After that one report, stop. Wait for /explainit in chat.`,
    )
    console.log(EXPLAIN_BODY_HINT)
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
      `VISUAL_CODER_EXPLAIN_READY Reported ${next.steps.length} explanation step(s) for "${next.question}". The visualizer shows them stacked as one list; the user navigates. Do not walk the map or change the current step.`,
    )
    if (next.presentation !== 'card' && next.steps.length === 1) {
      console.log(
        'If this walk has more files or topics, immediately re-run explain report ONCE with every --step in that same command. This report replaced the list, so only this one step is on the map.',
      )
    }
  }
  console.log(
    'Stop. Wait for the user to type /explainit in chat for a follow-up, or a change request to replace the waiting proposal.',
  )
}

export async function proposeBlueprint(args) {
  const { store, config } = await loadExplorer()
  const sessionParsed = takeFlagValue(args, '--session')
  const descriptionParsed = takeFlagValue(args, '--description')

  if (!sessionParsed) {
    usage(
      'propose-blueprint',
      '--session <color> --description "<description>" [layer.json|-] [--dont-write-to-file]',
    )
  }

  if (!descriptionParsed) {
    usage(
      'propose-blueprint',
      '--session <color> --description "<description>" [layer.json|-] [--dont-write-to-file]',
    )
  }

  if (args.includes('--write')) {
    console.error(
      'propose-blueprint writes the blueprint file unless you pass --dont-write-to-file. Omit --write.',
    )
    process.exit(1)
  }

  const sessionId = resolveFlagSession(store, sessionParsed)
  const dataDir = config.dataDir
  requireVisualizer(store, config)

  const manifest = store.readManifest(dataDir, sessionId)
  if (!manifest) {
    console.error(`Session not found: ${sessionParsed}`)
    process.exit(1)
  }

  const description = descriptionParsed
  const colorId = manifest.color
  const colorName = store.resolveSessionColor(colorId)?.name || colorId
  const dontWriteToFile = args.includes('--dont-write-to-file')
  const layerArg = proposedLayerArg(args)
  const raw = readProposedLayer(layerArg)
  if (raw && raw.trim()) {
    let layer
    try {
      layer = JSON.parse(raw)
    } catch {
      console.error('Could not parse proposed blueprint layer JSON')
      process.exit(1)
    }

    const [{ normalizeExtractLayer }, blueprintFiles] = await Promise.all([
      import('./extract-blueprint.mjs'),
      import(pathToFileURL(path.join(explorerRoot, 'scripts/blueprint-files.mjs')).href),
    ])
    const normalized = normalizeExtractLayer(layer)
    if (!Array.isArray(layer.steps)) {
      normalized.steps = store.readBlueprintByColor(dataDir, colorId).steps ?? []
    }
    const subjectSource =
      typeof layer.subject === 'string' && layer.subject.trim()
        ? layer.subject
        : description
    const numbered = blueprintFiles.nextNumberedBlueprintSet(
      config.targetRoot,
      subjectSource,
    )
    if (!dontWriteToFile) {
      const saved = blueprintFiles.saveBlueprintDocument(config.targetRoot, {
        name: numbered.name,
        folder: numbered.folderPath,
        blueprints: [{ color: colorId, ...normalized }],
      })
      const blueprintFile = saved.blueprintFiles[0]?.relativePath ?? saved.folder
      console.log(`VISUAL_CODER_BLUEPRINT_FILE ${blueprintFile}`)
      console.log(`VISUAL_CODER_BLUEPRINT_WRAPPER ${saved.relativePath}`)
    } else {
      console.log('VISUAL_CODER_BLUEPRINT_FILE skipped')
    }
    store.writeBlueprintByColor(dataDir, colorId, {
      ...store.emptyBlueprint(),
      ...normalized,
    })
    console.log(
      `VISUAL_CODER_BLUEPRINT_PROPOSED Session ${colorId} blueprint: ${normalized.files.length} file(s), ${normalized.folders.length} folder(s), ${normalized.functions.length} function(s), ${normalized.variables.length} var(s), ${normalized.imports.length} relation(s), ${normalized.notes.length} note(s), ${normalized.pointers.length} pointer(s), ${normalized.deleted.length} deleted file(s), ${normalized.steps.length} suggested step(s).`,
    )
    console.log('The blueprint is now visible on the map. The user can refine it by drawing on the map or by invoking the session color again with a more specific request.')
    console.log('To start implementing, invoke the session color (e.g., /coral) or run: npx inbase attach --color <color>')
    return
  }

  console.log(`VISUAL_CODER_ACK propose-blueprint: proposing blueprint for session ${colorId}`)
  console.log(`Propose a blueprint for the ${colorName} session from this description. It is a spatial plan that another LLM will follow.`)
  console.log(`VISUAL_CODER_PROPOSE_BLUEPRINT Session ${colorId} (${colorName})`)
  console.log(`Description: ${description}`)
  const currentSteps = store.readBlueprintByColor(dataDir, colorId).steps ?? []
  if (currentSteps.length > 0) {
    console.log(
      `VISUAL_CODER_BLUEPRINT_STEPS The ${colorName} blueprint already has ${currentSteps.length} suggested step(s) from the user. Weigh them against the description: keep the useful and relevant ones, reword, merge, or drop the rest, and add missing ones.`,
    )
    console.log('VISUAL_CODER_BLUEPRINT_STEPS_START')
    console.log(JSON.stringify(currentSteps, null, 2))
    console.log('VISUAL_CODER_BLUEPRINT_STEPS_END')
  }
  console.log('VISUAL_CODER_PROPOSE_BLUEPRINT_INSTRUCTION_START')
  console.log('Read interpreting-blueprints.md beside the inbase SKILL.md. Interpret every blueprint entity that way.')
  console.log('Read the codebase if needed, then curate a layer JSON. Paths are relative to the target root. Use every blueprint construct the description needs. Leave a field empty only when the plan does not need it.')
  console.log('Include "subject": a short kebab-case name for this plan, such as "timer". Saving writes the folder blueprints/<subject>-<num>/ in the target, with <subject>-<num>.blueprint.json and <subject>-<num>-wrapper.json. The number is the next free one for that subject. Pass --dont-write-to-file to update the map without writing that file.')
  console.log('files: A file is a new file the plan creates. A file that already exists is a pointer, not a file. [{"path":"src/timer/Timer.tsx"}]')
  console.log('folders: A folder is part of the folder skeleton the plan creates. Each level is its own entry. [{"path":"src/timer"}]')
  console.log('classes: A class is a class the plan adds, in a file. extends is its one parent class. implements names the interfaces or protocols it fulfills. Its methods are functions with class set to its name. Its fields are variables with class set to its name. The constructor is one of those functions. [{"name":"Timer","file":"src/timer/Timer.tsx","extends":"Clock","implements":["Tickable"]}]')
  console.log('functions: A function is a function, method, component, or hook the plan adds. A method includes class, the class it belongs to. A method that replaces a parent method sets overrides. [{"name":"start","file":"src/timer/Timer.tsx","class":"Timer","overrides":true}]')
  console.log('variables: A variable is a constant, a piece of shared state, a config value, or a field the plan adds. A field includes class, the class it belongs to. [{"name":"WORK_SECONDS","file":"src/timer/types.ts"}]')
  console.log('imports: An import is a relation between two files. file is the project path of the file that imports. from is the project path of the file that exports the symbol, the same kind of path as files and pointers, including when the two files are in different folders. from is never a symbol name, a package name, or a relative specifier such as ./useAuth or msal. name is the imported symbol. One symbol is one entry. Both paths are required. [{"name":"Timer","from":"src/timer/Timer.tsx","file":"src/App.tsx"}]')
  console.log('notes: A note is an instruction on a file, folder, class, function, or variable. It states the contract or a non-obvious invariant the plan must keep. A note on a method or field includes class.')
  console.log('  {"file":"src/timer","kind":"folder","note":"Timer feature. No extra packages."}')
  console.log('  {"file":"src/timer/Timer.tsx","kind":"file","note":"Wire the hook to the view."}')
  console.log('  {"file":"src/timer/Timer.tsx","kind":"function","name":"Timer","note":"Top-level component. Props only."}')
  console.log('  {"file":"src/timer/types.ts","kind":"variable","name":"WORK_SECONDS","note":"25 * 60. Do not read this from props."}')
  console.log('pointers: A pointer is a reference to a file, folder, class, function, or variable that already exists. Pay attention to it when setting up the plan, and usually edit it. It does not also go in files, folders, or classes. A method or field pointer includes class.')
  console.log('  {"kind":"file","path":"src/App.tsx"}')
  console.log('  {"kind":"folder","path":"src"}')
  console.log('  {"kind":"function","path":"src/App.tsx","name":"App"}')
  console.log('  {"kind":"variable","path":"src/theme.ts","name":"theme"}')
  console.log('deleted: A deleted entry is an existing file path the plan removes, including its imports, references, and usages. ["src/legacy/OldTimer.tsx"]')
  console.log('steps: A step is a suggested sentence for the plan. Decide which are useful and in what order. Keep, merge, split, reword, reorder, or drop them, and add missing ones. They are suggestions, not the plan itself. Start from the current blueprint steps if any. Omit steps to keep the current steps unchanged. ["Add the timer types and constants","Build the usePomodoro hook","Render Pomodoro in App"]')
  console.log('Put new modules in files and folders, with their functions, vars, relations, and notes. Point at the existing entry point you will edit.')
  console.log('Drop: generated files, lockfiles, dist/build/coverage, snapshots, editor/tooling noise, tests unless they are the contract, trivial re-export barrels, every helper/getter/loop var/one-off local, and notes that only restate the name.')
  console.log(`Then run: npx inbase propose-blueprint --session ${colorId} --description "${description}"`)
  console.log('and pass the curated layer JSON on stdin (or a layer.json path). That writes the blueprint file. Pass --dont-write-to-file to skip the file.')
  console.log('VISUAL_CODER_PROPOSE_BLUEPRINT_INSTRUCTION_END')
}

function proposedLayerArg(args) {
  const rest = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--session' || arg === '--description') {
      index += 1
      continue
    }
    if (arg === '--dont-write-to-file') continue
    rest.push(arg)
  }
  if (rest.length > 1) {
    console.error(`Unexpected arguments: ${rest.slice(1).join(' ')}`)
    process.exit(1)
  }
  return rest[0] ?? null
}

function readProposedLayer(layerArg) {
  if (layerArg && layerArg !== '-') return fs.readFileSync(layerArg, 'utf8')
  if (layerArg === '-' || !process.stdin.isTTY) return fs.readFileSync(0, 'utf8')
  return ''
}
