#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  applyHostEnv,
  copyDir,
  ensureDataDir,
  ensureGitignoreEntry,
  explorerRoot,
  isolatedViteConfig,
  resolveFromPackage,
  skillTemplateDir,
  commandTemplateDir,
  takeFlagValue,
} from './project.mjs'
import {
  proposePatch,
  reportPlan,
  runExplain,
  startSession,
  attachSession,
  waitForBlueprint,
  goProposal,
  acceptProposal,
} from './session.mjs'

const HELP = `inbase — a first-person 3D map of a codebase

Usage:
  inbase init              Install the Cursor skill in this repo
  inbase run               Scan this repo and start the local map
  inbase help              Show this help

Agent commands (used by the Cursor skill):
  inbase start-session --session <id> --name "short name"
  inbase attach [--session <id>] [--color <name>]
  inbase wait-for-blueprint --session <id>
  inbase report-plan --session <id> --feature "name" --steps "one"
  inbase go [--session <id>]
  inbase accept [--session <id>]
  inbase propose-patch --session <id> [file.patch|-]
  inbase propose-patch --session <id> --clear
  inbase explain start [--question "How does this work?"]
  inbase explain report --step "..." --body "..."
  inbase explain stop

Options for run:
  --target <dir>           Project to map (default: current directory)
  --port <number>          Dev server port (default: 5173)
`

function printHelp() {
  console.log(HELP.trim())
}

export function initProject(projectRoot = process.cwd()) {
  if (!fs.existsSync(skillTemplateDir)) {
    throw new Error(`Inbase skill template missing at ${skillTemplateDir}`)
  }
  const skillDir = path.join(projectRoot, '.cursor/skills/inbase')
  copyDir(skillTemplateDir, skillDir)
  const commandDir = path.join(projectRoot, '.cursor/commands')
  if (fs.existsSync(commandTemplateDir)) {
    copyDir(commandTemplateDir, commandDir)
  }
  const { dataDir } = applyHostEnv({
    cwd: projectRoot,
    target: projectRoot,
    dataDir: path.join(projectRoot, '.inbase'),
  })
  ensureDataDir(dataDir)
  const gitignoreAdded = ensureGitignoreEntry(projectRoot)
  return { skillDir, commandDir, dataDir, gitignoreAdded }
}

function explorerHref(relative) {
  return pathToFileURL(path.join(explorerRoot, relative)).href
}

async function runServer(args) {
  const target = takeFlagValue(args, '--target')
  const portValue = takeFlagValue(args, '--port')
  const port = portValue ? Number(portValue) : 5173
  if (portValue && !Number.isInteger(port)) {
    console.error('inbase run --port must be an integer')
    process.exit(1)
  }

  const { targetRoot, dataDir } = applyHostEnv({ target })
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
  console.log('Leave this running. Open a Cursor chat to connect — 5 chats can be connected at once.')
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
    console.log(`Installed Cursor skill at ${result.skillDir}`)
    if (fs.existsSync(path.join(result.commandDir, 'inbase.md'))) {
      console.log(`Installed /inbase command at ${result.commandDir}`)
    }
    if (result.gitignoreAdded) console.log('Added .inbase/ to .gitignore')
    console.log('Next: run `inbase run`, then ask Cursor to change source files.')
    return
  }

  if (command === 'run') {
    await runServer(args)
    return
  }

  const host = applyHostEnv()
  ensureDataDir(process.env.INBASE_DATA_DIR)
  if (host.instance) {
    console.log(
      `INBASE_ATTACHED Using the running visualizer (${host.instance.dataDir}). Run wait-for-blueprint to read the optional blueprint; it does not wait. Then stop for /go, /accept, or /explain in chat.`,
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
  if (command === 'wait-for-blueprint') {
    await waitForBlueprint(args)
    return
  }
  if (command === 'report-plan') {
    await reportPlan(args)
    return
  }
  if (command === 'wait-for-approval') {
    console.error(
      'wait-for-approval was removed. The user types /go, /accept, or /explain in chat.',
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
