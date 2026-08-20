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
  skillTemplateDir,
  takeFlagValue,
} from './project.mjs'
import {
  proposePatch,
  reportPlan,
  startSession,
  waitForApproval,
  waitForBlueprint,
} from './session.mjs'

const HELP = `inbase — a first-person 3D map of a codebase

Usage:
  inbase init              Install the Cursor skill in this repo
  inbase run               Scan this repo and start the local map
  inbase help              Show this help

Agent commands (used by the Cursor skill):
  inbase start-session --session <id> [--feature "name"]
  inbase wait-for-blueprint --session <id>
  inbase report-plan --session <id> --feature "name" --steps "one" [--steps "two"]
  inbase wait-for-approval --session <id>
  inbase propose-patch --session <id> <file.patch|->
  inbase propose-patch --session <id> --clear

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
  const { dataDir } = applyHostEnv({
    cwd: projectRoot,
    target: projectRoot,
    dataDir: path.join(projectRoot, '.inbase'),
  })
  ensureDataDir(dataDir)
  const gitignoreAdded = ensureGitignoreEntry(projectRoot)
  return { skillDir, dataDir, gitignoreAdded }
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

  const { createServer } = await import('vite')
  const server = await createServer({
    configFile: path.join(explorerRoot, 'vite.config.ts'),
    root: explorerRoot,
    server: {
      port,
      host: '127.0.0.1',
      fs: {
        allow: [explorerRoot, targetRoot, dataDir],
      },
    },
  })
  await server.listen()
  const local = server.resolvedUrls?.local?.[0] ?? `http://localhost:${port}/`
  console.log(`Inbase is mapping ${targetRoot}`)
  console.log(`Open ${local}`)
  console.log('Leave this running. In Cursor, the inbase skill talks to this server.')
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
    if (result.gitignoreAdded) console.log('Added .inbase/ to .gitignore')
    console.log('Next: run `inbase run`, then ask Cursor to change source files.')
    return
  }

  if (command === 'run') {
    await runServer(args)
    return
  }

  applyHostEnv()
  ensureDataDir(process.env.INBASE_DATA_DIR)

  if (command === 'start-session') {
    await startSession(args)
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
    await waitForApproval(args)
    return
  }
  if (command === 'propose-patch') {
    await proposePatch(args)
    return
  }

  console.error(`Unknown command: ${command}\n`)
  printHelp()
  process.exitCode = 1
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invoked === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
