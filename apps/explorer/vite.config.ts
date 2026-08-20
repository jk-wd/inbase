import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { emptyIntent } from './scripts/patch-lib.mjs'
import { dataDir, targetRoot } from './scripts/target-config.mjs'
import { editorFileUri, openInEditor } from './scripts/open-editor.mjs'
import {
  answerBlueprint,
  continueDiff,
  inspectTargetFile,
  invokeStep,
  readActiveSession,
  requestReplan,
  sendBlueprint,
  sessionIntent,
  stopSession,
  updateBlueprint,
} from './scripts/session-store.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
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

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function jsonFilePlugin(): Plugin {
  return {
    name: 'visual-coder-json-files',
    configureServer(server) {
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
        next()
      })

      server.middlewares.use('/api/agent-intent', (req, res, next) => {
        if (req.method === 'GET') {
          const url = new URL(req.url ?? '/', 'http://visual-coder.local')
          const sessionId = url.searchParams.get('sessionId') ?? readActiveSession(dataDir)
          const diffId = url.searchParams.get('diffId') ?? undefined
          const intent = sessionId
            ? sessionIntent(dataDir, sessionId, knownFileIds(), diffId)
            : null
          sendJson(res, 200, intent ?? { ...emptyIntent })
          return
        }

        if (req.method === 'POST') {
          void decideIntent(req, res)
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
      step?: number
      userCreatedBlocks?: unknown[]
      userCreatedIslands?: unknown[]
      addedFunctions?: unknown[]
      addedVariables?: unknown[]
      addedImports?: unknown[]
    }
    const action = body.action
    if (
      action !== 'invoke' &&
      action !== 'continue' &&
      action !== 'instruct' &&
      action !== 'stop' &&
      action !== 'blueprint_yes' &&
      action !== 'blueprint_no' &&
      action !== 'blueprint_send' &&
      action !== 'blueprint_update'
    ) {
      sendJson(res, 400, { error: 'invalid workflow action' })
      return
    }
    if (!body.sessionId) {
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

    if (action === 'invoke') {
      if (!Number.isInteger(body.step)) {
        sendJson(res, 400, { error: 'step is required for invoke' })
        return
      }
      invokeStep(dataDir, body.sessionId, body.step as number, targetRoot)
      const scan = spawnSync(process.execPath, [scanScript], {
        cwd: here,
        encoding: 'utf8',
        env: scanEnv,
      })
      if (scan.status !== 0) {
        console.error(scan.stderr || scan.stdout || 'scan failed after invoking step')
      }
    } else if (action === 'continue') {
      if (!body.diffId) {
        sendJson(res, 400, { error: 'diffId is required for continue' })
        return
      }
      continueDiff(dataDir, targetRoot, body.sessionId, body.diffId)
      const scan = spawnSync(process.execPath, [scanScript], {
        cwd: here,
        encoding: 'utf8',
        env: scanEnv,
      })
      if (scan.status !== 0) {
        console.error(scan.stderr || scan.stdout || 'scan failed after applying patch')
      }
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
      )
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
      })
    } else if (action === 'blueprint_send') {
      sendBlueprint(dataDir, body.sessionId, {
        userCreatedBlocks: body.userCreatedBlocks,
        userCreatedIslands: body.userCreatedIslands,
        addedFunctions: body.addedFunctions,
        addedVariables: body.addedVariables,
        addedImports: body.addedImports,
      })
    } else {
      stopSession(dataDir, body.sessionId, targetRoot)
    }
    const next = sessionIntent(dataDir, body.sessionId, knownFileIds())
    sendJson(res, 200, next ?? { ...emptyIntent })
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
    }
  } catch {
    return { followLook: false }
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

export default defineConfig({
  plugins: [react(), jsonFilePlugin()],
  server: {
    port: 5173,
    fs: {
      allow: [here, dataDir],
    },
  },
})
