import * as agents from './agents.mjs'
import * as claude from './claude.mjs'
import * as cline from './cline.mjs'
import * as copilot from './copilot.mjs'
import * as cursor from './cursor.mjs'

/** Ordered editor adapters. Add a module here to install skills for another editor. */
export const editors = [cursor, claude, agents, copilot, cline]

const EDITOR_ALIASES = {
  cursor: 'cursor',
  claude: 'claude',
  'claude-code': 'claude',
  agents: 'agents',
  agent: 'agents',
  codex: 'agents',
  copilot: 'copilot',
  github: 'copilot',
  'github-copilot': 'copilot',
  cline: 'cline',
}

export function editorIds() {
  return editors.map((editor) => editor.id)
}

export function isAllEditors(name) {
  return name == null || name === '' || String(name).trim().toLowerCase() === 'all'
}

export function selectEditors(name) {
  if (isAllEditors(name)) {
    return editors
  }
  const key = String(name).trim().toLowerCase()
  const id = EDITOR_ALIASES[key] ?? key
  const match = editors.filter((editor) => editor.id === id)
  if (match.length === 0) {
    throw new Error(`Unknown editor '${name}'. Use one of: ${editorIds().join(', ')}`)
  }
  return match
}

export function installEditors(projectRoot, name) {
  return selectEditors(name).map((editor) => editor.install(projectRoot))
}

export function uninstallEditors(projectRoot, name) {
  return selectEditors(name).map((editor) => editor.uninstall(projectRoot))
}
