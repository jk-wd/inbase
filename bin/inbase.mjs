#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  applyHostEnv,
  ensureDataDir,
  ensureGitignoreEntry,
  explorerRoot,
  isolatedViteConfig,
  resolveFromPackage,
  takeFlagValue,
} from './project.mjs'
import { resolvePort, writeInbaseConfig } from './inbase-config.mjs'
import { installEditors } from './editors/index.mjs'
import {
  proposePatch,
  reportPlan,
  runExplain,
  startSession,
  attachSession,
  readBlueprint,
  goProposal,
  acceptProposal,
} from './session.mjs'
import { extractBlueprint } from './extract-blueprint.mjs'

const HELP = `inbase — a first-person 3D map of a codebase

Usage:
  inbase init              Install Cursor, Claude Code, Codex, Copilot, and Cline skills
  inbase run               Scan this repo and start the local map
  inbase extract-blueprint <folder> <output-file>
  inbase help              Show this help

Agent commands (used by the installed skill):
  inbase start-session --session <id> --name "short name"
  inbase attach [--session <id>] [--color <name>]
  inbase read-blueprint --session <id>
  inbase report-plan --session <id> --feature "name" --steps "one"
  inbase accept [--session <id>]
  inbase propose-patch --session <id> [file.patch|-]
  inbase propose-patch --session <id> --clear
  inbase explain start [--question "How does this work?"]
  inbase explain report --step "..." --body "..."
  inbase explain stop
  inbase extract-blueprint <folder> <output-file> [--write [layer.json|-]]

Options for run:
  --target <dir>           Project to map (default: inbase.json target, else cwd)
  --port <number>          Dev server port (default: inbase.json port, else 5173)
`

function printHelp() {
  console.log(HELP.trim())
}

export function initProject(projectRoot = process.cwd()) {
  const installed = installEditors(projectRoot)
  const cursor = installed.find((editor) => editor.id === 'cursor') ?? installed[0]
  if (!cursor) {
    throw new Error('No editor adapters are registered')
  }
  const { dataDir } = applyHostEnv({
    cwd: projectRoot,
    target: projectRoot,
    dataDir: path.join(projectRoot, '.inbase'),
  })
  ensureDataDir(dataDir)
  const gitignoreAdded = ensureGitignoreEntry(projectRoot)
  const configAdded = writeInbaseConfig(projectRoot)
  return {
    skillDir: cursor.skillDir,
    commandDir: cursor.commandDir,
    dataDir,
    gitignoreAdded,
    configAdded,
    editors: installed,
  }
}

function explorerHref(relative) {
  return pathToFileURL(path.join(explorerRoot, relative)).href
}

async function runServer(args) {
  const target = takeFlagValue(args, '--target') || undefined
  const { targetRoot, dataDir, config } = applyHostEnv({ target })
  let port
  try {
    port = resolvePort(takeFlagValue(args, '--port'), config)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }

  if (!fs.existsSync(targetRoot)) {
    console.error(`Target not found at ${targetRoot}`)
    process.exit(1)
  }
  ensureDataDir(dataDir)

  const { scanTarget } = await import(explorerHref('scripts/scan-target.mjs'))
  const { targetName } = await import(explorerHref('scripts/target-config.mjs'))
  scanTarget({
    root: targetRoot,
    name: targetName,
    dest: path.join(dataDir, 'codebase.json'),
    ignore: config.ignore,
  })

  const { createServer } = await import(pathToFileURL(resolveFromPackage('vite')).href)
  const isolation = isolatedViteConfig(dataDir)
  const server = await createServer({
    configFile: path.join(explorerRoot, 'vite.config.ts'),
    ...isolation,
    server: {
      ...isolation.server,
      port,
      host: '127.0.0.1',
    },
  })
  await server.listen()
  const local = server.resolvedUrls?.local?.[0] ?? `http://localhost:${port}/`
  console.log(`Inbase is mapping ${targetRoot}`)
  console.log(`Open ${local}`)
  console.log(
    'Leave this running. Open a Cursor, Claude Code, Codex, Copilot, or Cline chat to connect — 5 chats can be connected at once.',
  )
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv
  if (
    !command ||
    command === 'help' ||
    command === '-h' ||
    command === '--help'
  ) {
    printHelp()
    return
  }

  if (command === 'init') {
    const result = initProject()
    for (const editor of result.editors) {
      const name = editor.label ?? editor.id
      console.log(`Installed ${name} skill at ${editor.skillDir}`)
      if (!editor.commandDir) continue
      if (fs.existsSync(path.join(editor.commandDir, 'accept/SKILL.md'))) {
        console.log(`Installed command skills at ${editor.commandDir}`)
      } else if (fs.existsSync(path.join(editor.commandDir, 'inbase.md'))) {
        console.log(`Installed /inbase command at ${editor.commandDir}`)
      } else {
        console.log(`Installed slash commands at ${editor.commandDir}`)
      }
    }
    if (result.gitignoreAdded) console.log('Added .inbase/ to .gitignore')
    if (result.configAdded) console.log('Wrote inbase.json')
    console.log(
      'Next: run `inbase run`, then ask Cursor, Claude Code, Codex, Copilot, or Cline to change source files.',
    )
    return
  }

  if (command === 'run') {
    await runServer(args)
    return
  }

  if (command === 'extract-blueprint') {
    const host = applyHostEnv()
    await extractBlueprint(args, host)
    return
  }

  const host = applyHostEnv()
  ensureDataDir(process.env.INBASE_DATA_DIR)
  if (host.instance) {
    console.log(
      `INBASE_ATTACHED Using the running visualizer (${host.instance.dataDir}). Run read-blueprint to load the optional blueprint. Then stop for /accept or /explain in chat.`,
    )
  }

  if (command === 'start-session') {
    await startSession(args)
    return
  }
  if (command === 'attach') {
    await attachSession(args)
    return
  }
  if (command === 'read-blueprint') {
    await readBlueprint(args)
    return
  }
  if (command === 'report-plan') {
    await reportPlan(args)
    return
  }
  if (command === 'wait-for-approval') {
    console.error(
      'wait-for-approval was removed. The user types /accept or /explain in chat.',
    )
    process.exit(1)
  }
  if (command === 'go') {
    await goProposal(args)
    return
  }
  if (command === 'accept') {
    await acceptProposal(args)
    return
  }
  if (command === 'propose-patch') {
    await proposePatch(args)
    return
  }
  if (command === 'explain') {
    await runExplain(args)
    return
  }

  console.error(`Unknown command: ${command}\n`)
  printHelp()
  process.exitCode = 1
}

export function isCliEntry(argv1 = process.argv[1]) {
  if (!argv1) return false
  const self = fileURLToPath(import.meta.url)
  try {
    return fs.realpathSync(argv1) === fs.realpathSync(self)
  } catch {
    return path.resolve(argv1) === path.resolve(self)
  }
}

if (isCliEntry()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
