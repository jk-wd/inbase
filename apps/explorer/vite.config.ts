import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { emptyIntent } from './scripts/patch-lib.mjs'
import { readBranchChanges } from './scripts/branch-changes.mjs'
import { writeRunningInstance, isolatedViteConfig, packageRoot } from '../../bin/project.mjs'
import { dataDir, targetRoot } from './scripts/target-config.mjs'
import { editorFileUri, openInEditor } from './scripts/open-editor.mjs'
import {
  answerBlueprint,
  clearDiffSessions,
  continueDiff,
  inspectTargetFile,
  invokeStep,
  listSessionIntents,
  nextAttachSessionId,
  readActiveSession,
  requestReplan,
  sendBlueprint,
  sessionIntent,
  setInitialInstruction,
  setStepByStep,
  setupSession,
  focusSession,
  stopSession,
  updateBlueprint,
  readBlueprint,
  setBlueprintHidden,
  clearBlueprint,
  cleanupBlueprint,
} from './scripts/session-store.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const requireFromPackage = createRequire(path.join(packageRoot, 'package.json'))
const isolation = isolatedViteConfig(dataDir)

function pkgDir(name: string) {
  return path.dirname(requireFromPackage.resolve(`${name}/package.json`))
}
const userContextFile = path.join(dataDir, 'user-context.json')
const codebaseFile = path.join(dataDir, 'codebase.json')
const scanScript = path.resolve(here, 'scripts/scan-target.mjs')

// The rescan runs with cwd set to the explorer, so hand it the already-resolved
// root and data dir instead of letting relative env values resolve differently.
const scanEnv = {
  ...process.env,
  VISUAL_CODER_TARGET: targetRoot,
  INBASE_DATA_DIR: dataDir,
}

function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function rescanTarget(when: string) {
  const scan = spawnSync(process.execPath, [scanScript], {
    cwd: here,
    encoding: 'utf8',
    env: scanEnv,
  })
  if (scan.status !== 0) {
    console.error(scan.stderr || scan.stdout || `scan failed ${when}`)
    return false
  }
  return true
}

function knownFileIds() {
  try {
    const graph = JSON.parse(fs.readFileSync(codebaseFile, 'utf8')) as {
      files?: Array<{ id?: string }>
    }
    return Array.isArray(graph.files)
      ? graph.files.map((file) => file.id).filter((id): id is string => Boolean(id))
      : []
  } catch {
    return []
  }
}

function knownFolderPaths() {
  try {
    const graph = JSON.parse(fs.readFileSync(codebaseFile, 'utf8')) as {
      folders?: Array<{ path?: string }>
    }
    return Array.isArray(graph.folders)
      ? graph.folders
          .map((folder) => folder.path)
          .filter((path): path is string => Boolean(path))
      : []
  } catch {
    return []
  }
}

function blueprintIntentFields() {
  const blueprint = readBlueprint(dataDir)
  return {
    creationMode: true,
    blueprintHidden: Boolean(blueprint.hidden),
    blueprintRevision: blueprint.revision,
    userCreatedBlocks: blueprint.userCreatedBlocks,
    userCreatedIslands: blueprint.userCreatedIslands,
    blueprintFunctions: blueprint.addedFunctions,
    blueprintVariables: blueprint.addedVariables,
    blueprintImports: blueprint.addedImports,
    blueprintNotes: blueprint.notes,
  }
}

function intentResponse(sessionId?: string) {
  const base =
    sessionId !== undefined && sessionId !== ''
      ? (sessionIntent(dataDir, sessionId, knownFileIds()) ?? { ...emptyIntent })
      : { ...emptyIntent }
  return { ...base, ...blueprintIntentFields() }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function jsonFilePlugin(): Plugin {
  return {
    name: 'visual-coder-json-files',
    configureServer(server) {
      writeRunningInstance({
        dataDir,
        targetRoot,
        port: server.config.server.port ?? 5173,
      })
      // Always boot with no LLM session. Leftover diffs and pointers are not restored.
      clearDiffSessions(dataDir, targetRoot)
      rescanTarget('after discarding leftover LLM sessions')
      server.middlewares.use('/api/user-context', (req, res, next) => {
        if (req.method === 'GET') {
          sendJson(res, 200, readUserContext())
          return
        }
        if (req.method === 'POST') {
          void writeUserContext(req, res)
          return
        }
        next()
      })

      server.middlewares.use('/api/codebase', (req, res, next) => {
        if (req.method === 'GET') {
          sendJson(res, 200, readCodebase())
          return
        }
        if (req.method === 'POST') {
          if (!rescanTarget('on user request')) {
            sendJson(res, 500, { error: 'scan failed' })
            return
          }
          sendJson(res, 200, readCodebase())
          return
        }
        next()
      })

      server.middlewares.use('/api/agent-intent', (req, res, next) => {
        if (req.method === 'GET') {
          const url = new URL(req.url ?? '/', 'http://visual-coder.local')
          const sessionId = url.searchParams.get('sessionId')
          const diffId = url.searchParams.get('diffId') ?? undefined
          if (sessionId) {
            const intent = sessionIntent(
              dataDir,
              sessionId,
              knownFileIds(),
              diffId,
            )
            sendJson(res, 200, intent ?? { ...emptyIntent })
            return
          }
          sendJson(res, 200, {
            focusedSessionId: readActiveSession(dataDir),
            nextAttachSessionId: nextAttachSessionId(dataDir),
            intents: listSessionIntents(dataDir, knownFileIds()),
            blueprint: readBlueprint(dataDir),
          })
          return
        }

        if (req.method === 'POST') {
          void decideIntent(req, res)
          return
        }

        next()
      })

      server.middlewares.use('/api/branch-changes', (req, res, next) => {
        if (req.method === 'GET') {
          sendJson(res, 200, readBranchChanges(targetRoot, knownFileIds()))
          return
        }
        next()
      })

      server.middlewares.use('/api/inspect-file', (req, res, next) => {
        if (req.method === 'POST') {
          void inspectFile(req, res)
          return
        }
        next()
      })
    },
  }
}

async function inspectFile(req: IncomingMessage, res: ServerResponse) {
  try {
    const body = JSON.parse(await readBody(req)) as {
      sessionId?: string
      diffId?: string
      fileId?: string
    }
    const filePath = inspectTargetFile(dataDir, targetRoot, {
      sessionId: body.sessionId,
      diffId: body.diffId,
      fileId: body.fileId,
    })
    if (!filePath) {
      sendJson(res, 200, { path: null, uri: null, opened: false })
      return
    }
    const opened = openInEditor(filePath)
    sendJson(res, 200, {
      path: filePath,
      uri: editorFileUri(filePath),
      opened,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid request'
    sendJson(res, 400, { error: message })
  }
}

async function decideIntent(req: IncomingMessage, res: ServerResponse) {
  try {
    const body = JSON.parse(await readBody(req)) as {
      action?: string
      sessionId?: string
      diffId?: string
      instruction?: string
      name?: string
      step?: number
      stepByStep?: boolean
      hidden?: boolean
      userCreatedBlocks?: unknown[]
      userCreatedIslands?: unknown[]
      addedFunctions?: unknown[]
      addedVariables?: unknown[]
      addedImports?: unknown[]
      notes?: unknown[]
    }
    const action = body.action
    const blueprintActions = new Set([
      'blueprint_update',
      'blueprint_clear',
      'blueprint_cleanup',
      'blueprint_set_hidden',
    ])
    if (
      action !== 'invoke' &&
      action !== 'continue' &&
      action !== 'instruct' &&
      action !== 'stop' &&
      action !== 'blueprint_yes' &&
      action !== 'blueprint_no' &&
      action !== 'blueprint_send' &&
      action !== 'blueprint_update' &&
      action !== 'blueprint_clear' &&
      action !== 'blueprint_cleanup' &&
      action !== 'blueprint_set_hidden' &&
      action !== 'focus' &&
      action !== 'set_step_by_step' &&
      action !== 'set_initial_instruction' &&
      action !== 'setup_session'
    ) {
      sendJson(res, 400, { error: 'invalid workflow action' })
      return
    }
    if (
      action !== 'setup_session' &&
      !blueprintActions.has(action ?? '') &&
      !body.sessionId
    ) {
      sendJson(res, 400, { error: 'sessionId is required' })
      return
    }
    if (
      body.instruction !== undefined &&
      (typeof body.instruction !== 'string' || body.instruction.length > 4000)
    ) {
      sendJson(res, 400, { error: 'instruction must be a string up to 4000 characters' })
      return
    }

    if (
      body.name !== undefined &&
      (typeof body.name !== 'string' || body.name.length > 200)
    ) {
      sendJson(res, 400, { error: 'name must be a string up to 200 characters' })
      return
    }

    if (action === 'invoke') {
      if (!Number.isInteger(body.step)) {
        sendJson(res, 400, { error: 'step is required for invoke' })
        return
      }
      invokeStep(dataDir, body.sessionId, body.step as number, targetRoot)
    } else if (action === 'continue') {
      if (!body.diffId) {
        sendJson(res, 400, { error: 'diffId is required for continue' })
        return
      }
      continueDiff(dataDir, targetRoot, body.sessionId, body.diffId)
      rescanTarget('after applying patch')
    } else if (action === 'instruct') {
      if (!body.diffId) {
        sendJson(res, 400, { error: 'diffId is required for instruct' })
        return
      }
      requestReplan(
        dataDir,
        body.sessionId,
        body.diffId,
        body.instruction ?? '',
        targetRoot,
      )
      rescanTarget('after withdrawing a patch')
    } else if (action === 'blueprint_yes') {
      answerBlueprint(dataDir, body.sessionId, true)
    } else if (action === 'blueprint_no') {
      answerBlueprint(dataDir, body.sessionId, false)
    } else if (action === 'blueprint_update') {
      updateBlueprint(dataDir, body.sessionId, {
        userCreatedBlocks: body.userCreatedBlocks,
        userCreatedIslands: body.userCreatedIslands,
        addedFunctions: body.addedFunctions,
        addedVariables: body.addedVariables,
        addedImports: body.addedImports,
        notes: body.notes,
      })
    } else if (action === 'blueprint_clear') {
      clearBlueprint(dataDir)
    } else if (action === 'blueprint_cleanup') {
      cleanupBlueprint(dataDir, knownFileIds(), knownFolderPaths())
    } else if (action === 'blueprint_set_hidden') {
      setBlueprintHidden(dataDir, Boolean(body.hidden))
    } else if (action === 'blueprint_send') {
      sendBlueprint(dataDir, body.sessionId, {
        userCreatedBlocks: body.userCreatedBlocks,
        userCreatedIslands: body.userCreatedIslands,
        addedFunctions: body.addedFunctions,
        addedVariables: body.addedVariables,
        addedImports: body.addedImports,
        notes: body.notes,
      })
    } else if (action === 'setup_session') {
      const manifest = setupSession(dataDir, {
        sessionId: body.sessionId,
        name: body.name,
      })
      const next = intentResponse(manifest.sessionId)
      sendJson(res, 200, next ?? { ...emptyIntent, ...blueprintIntentFields() })
      return
    } else if (action === 'set_initial_instruction') {
      setInitialInstruction(dataDir, body.sessionId, body.instruction ?? '')
    } else if (action === 'focus') {
      focusSession(dataDir, body.sessionId)
    } else if (action === 'set_step_by_step') {
      if (typeof body.stepByStep !== 'boolean') {
        sendJson(res, 400, { error: 'stepByStep is required' })
        return
      }
      setStepByStep(dataDir, body.sessionId, body.stepByStep, targetRoot)
      rescanTarget('after changing step-by-step mode')
    } else {
      stopSession(dataDir, body.sessionId, targetRoot)
      rescanTarget('after stopping session')
    }
    const next = intentResponse(body.sessionId)
    sendJson(res, 200, next ?? { ...emptyIntent, ...blueprintIntentFields() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid request'
    sendJson(res, 400, { error: message })
  }
}

function readCodebase() {
  try {
    return JSON.parse(fs.readFileSync(codebaseFile, 'utf8')) as {
      root?: string
      targetName?: string
      files?: unknown[]
      folders?: unknown[]
    }
  } catch {
    return {
      root: '.',
      targetName: path.basename(targetRoot),
      files: [],
      folders: [
        {
          path: '.',
          name: path.basename(targetRoot),
          parent: null,
          files: [],
          children: [],
        },
      ],
    }
  }
}

function readUserContext() {
  try {
    const parsed = JSON.parse(fs.readFileSync(userContextFile, 'utf8')) as Record<
      string,
      unknown
    >
    return {
      ...parsed,
      followLook: Boolean(parsed.followLook),
      showBranchChanges: Boolean(parsed.showBranchChanges),
    }
  } catch {
    return { followLook: false, showBranchChanges: false }
  }
}

async function writeUserContext(req: IncomingMessage, res: ServerResponse) {
  try {
    const incoming = JSON.parse(await readBody(req)) as Record<string, unknown>
    const existing = readUserContext()
    const next = {
      ...existing,
      ...incoming,
      followLook:
        typeof incoming.followLook === 'boolean'
          ? incoming.followLook
          : Boolean(existing.followLook),
      showBranchChanges:
        typeof incoming.showBranchChanges === 'boolean'
          ? incoming.showBranchChanges
          : Boolean(existing.showBranchChanges),
    }
    delete next.userCreatedBlocks
    delete next.userCreatedIslands
    fs.mkdirSync(path.dirname(userContextFile), { recursive: true })
    fs.writeFileSync(userContextFile, `${JSON.stringify(next, null, 2)}\n`)
    res.statusCode = 204
    res.end()
  } catch {
    res.statusCode = 400
    res.end('invalid json')
  }
}

function isDataDirPath(filePath: string) {
  const file = path.resolve(filePath)
  const root = path.resolve(dataDir)
  return file === root || file.startsWith(root + path.sep)
}

export default defineConfig({
  ...isolation,
  plugins: [react(), jsonFilePlugin()],
  resolve: {
    alias: {
      react: pkgDir('react'),
      'react-dom': pkgDir('react-dom'),
      three: pkgDir('three'),
      '@react-three/fiber': pkgDir('@react-three/fiber'),
      '@react-three/drei': pkgDir('@react-three/drei'),
    },
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei'],
  },
  optimizeDeps: {
    ...isolation.optimizeDeps,
    include: [
      'react',
      'react-dom',
      'three',
      '@react-three/fiber',
      '@react-three/drei',
    ],
  },
  server: {
    ...isolation.server,
    port: 5173,
    watch: {
      // Session snapshots copy target source into the data dir. If Vite
      // watches those writes, Create proposal full-reloads the visualizer.
      ignored: ['**/src/data/**', isDataDirPath],
    },
  },
})
