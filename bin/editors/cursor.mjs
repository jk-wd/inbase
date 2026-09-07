import fs from 'node:fs'
import path from 'node:path'
import { removeEmptyParents } from '../project.mjs'
import {
  copySkillAndCommands,
  looksLikeInbaseFile,
  removeSkillAndCommands,
  sweepInbaseRules,
} from './layout.mjs'

export const id = 'cursor'
export const label = 'Cursor'

const LAYOUT = {
  id,
  skillRel: '.cursor/skills/inbase',
  commandRel: '.cursor/commands',
}

/** Steers Cursor Auto-review so Inbase CLI is not treated as a remote publish. */
export const CURSOR_INBASE_ALLOW_INSTRUCTION =
  'Always auto-run npx inbase commands (attach, read-blueprint, report-plan, accept, propose-patch, explain, and other inbase subcommands), including when prefixed with cd to this project. They only write local Visual Coder session files under .inbase/ in this repo. They are not remote publishes or shared-state writes to an external system, and must run without asking for approval.'

function cursorFile(projectRoot, name) {
  return path.join(projectRoot, '.cursor', name)
}

function parseJsoncFile(file) {
  if (!fs.existsSync(file)) return null
  const text = fs.readFileSync(file, 'utf8')
  try {
    return JSON.parse(text)
  } catch {
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    try {
      return JSON.parse(stripped)
    } catch {
      return null
    }
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
}

function isEmptyPermissions(data) {
  if (!data || typeof data !== 'object') return true
  for (const [key, value] of Object.entries(data)) {
    if (key === 'autoRun') {
      if (Array.isArray(value?.allow_instructions) && value.allow_instructions.length > 0) {
        return false
      }
      if (Array.isArray(value?.block_instructions) && value.block_instructions.length > 0) {
        return false
      }
      continue
    }
    if (Array.isArray(value)) {
      if (value.length > 0) return false
      continue
    }
    if (value && typeof value === 'object') {
      if (Object.keys(value).length > 0) return false
      continue
    }
    if (value != null && value !== '') return false
  }
  return true
}

export function installCursorPermissions(projectRoot) {
  const file = cursorFile(projectRoot, 'permissions.json')
  const data = parseJsoncFile(file) ?? {}
  const autoRun =
    data.autoRun && typeof data.autoRun === 'object' ? { ...data.autoRun } : {}
  const allow = Array.isArray(autoRun.allow_instructions)
    ? [...autoRun.allow_instructions]
    : []
  if (!allow.includes(CURSOR_INBASE_ALLOW_INSTRUCTION)) {
    allow.push(CURSOR_INBASE_ALLOW_INSTRUCTION)
  }
  autoRun.allow_instructions = allow
  data.autoRun = autoRun
  writeJson(file, data)
}

export function uninstallCursorPermissions(projectRoot) {
  const file = cursorFile(projectRoot, 'permissions.json')
  if (!fs.existsSync(file)) return false
  const data = parseJsoncFile(file)
  if (!data) {
    if (looksLikeInbaseFile(file)) {
      fs.unlinkSync(file)
      return true
    }
    return false
  }
  let changed = false
  if (Array.isArray(data.autoRun?.allow_instructions)) {
    const next = data.autoRun.allow_instructions.filter(
      (line) => line !== CURSOR_INBASE_ALLOW_INSTRUCTION,
    )
    if (next.length !== data.autoRun.allow_instructions.length) {
      changed = true
      if (next.length > 0) data.autoRun.allow_instructions = next
      else delete data.autoRun.allow_instructions
    }
    if (data.autoRun && Object.keys(data.autoRun).length === 0) {
      delete data.autoRun
    }
  }
  if (isEmptyPermissions(data)) {
    fs.unlinkSync(file)
    return true
  }
  if (changed) {
    writeJson(file, data)
    return true
  }
  return false
}

export function installCursorSandbox(projectRoot) {
  const file = cursorFile(projectRoot, 'sandbox.json')
  const data = parseJsoncFile(file) ?? {}
  if (data.enableSharedBuildCache === true) return
  data.enableSharedBuildCache = true
  writeJson(file, data)
}

export function uninstallCursorSandbox(projectRoot) {
  const file = cursorFile(projectRoot, 'sandbox.json')
  if (!fs.existsSync(file)) return false
  const data = parseJsoncFile(file)
  if (!data) return false
  const keys = Object.keys(data)
  if (keys.length === 1 && keys[0] === 'enableSharedBuildCache' && data.enableSharedBuildCache === true) {
    fs.unlinkSync(file)
    return true
  }
  return false
}

export function install(projectRoot) {
  installCursorPermissions(projectRoot)
  installCursorSandbox(projectRoot)
  return { ...copySkillAndCommands(projectRoot, LAYOUT), label }
}

export function uninstall(projectRoot) {
  const result = removeSkillAndCommands(projectRoot, LAYOUT)
  let removed = result.removed
  if (uninstallCursorPermissions(projectRoot)) removed = true
  if (uninstallCursorSandbox(projectRoot)) removed = true
  const rulesDir = path.join(projectRoot, '.cursor/rules')
  if (sweepInbaseRules(rulesDir)) removed = true
  removeEmptyParents(rulesDir, projectRoot)
  return { ...result, removed, label }
}
