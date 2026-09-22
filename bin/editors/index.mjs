import * as agents from './agents.mjs'
import * as bionic from './bionic.mjs'
import * as claude from './claude.mjs'
import * as cline from './cline.mjs'
import * as copilot from './copilot.mjs'
import * as cursor from './cursor.mjs'
import * as lmstudio from './lmstudio.mjs'
import * as opencode from './opencode.mjs'
import * as zed from './zed.mjs'

/** Ordered editor adapters. Add a module here to install skills for another editor. */
export const editors = [
  cursor,
  claude,
  agents,
  zed,
  copilot,
  cline,
  opencode,
  lmstudio,
  bionic,
]

const EDITOR_ALIASES = {
  cursor: 'cursor',
  claude: 'claude',
  'claude-code': 'claude',
  agents: 'agents',
  agent: 'agents',
  codex: 'agents',
  zed: 'zed',
  copilot: 'copilot',
  github: 'copilot',
  'github-copilot': 'copilot',
  cline: 'cline',
  opencode: 'opencode',
  'open-code': 'opencode',
  lmstudio: 'lmstudio',
  'lm-studio': 'lmstudio',
  lms: 'lmstudio',
  bionic: 'bionic',
}

/** LM Studio and Bionic share one init: native `.lmstudio/skills` plus `.agents/skills`. */
const EDITOR_BUNDLES = {
  lmstudio: ['lmstudio', 'bionic'],
  bionic: ['lmstudio', 'bionic'],
}

export function editorIds() {
  return editors.map((editor) => editor.id)
}

export function editorList() {
  return editorIds().join(', ')
}

export function isAllEditors(name) {
  return name == null || name === '' || String(name).trim().toLowerCase() === 'all'
}

export function missingEditorError() {
  return new Error(`Specify an editor. Use one of: ${editorList()}`)
}

/** Canonical adapter id for an init name, or null when missing/unknown/`all`. */
export function canonicalEditorId(name) {
  if (isAllEditors(name)) return null
  const key = String(name).trim().toLowerCase()
  const id = EDITOR_ALIASES[key] ?? key
  return editors.some((editor) => editor.id === id) ? id : null
}

export function selectEditors(name) {
  if (isAllEditors(name)) {
    return editors
  }
  const key = String(name).trim().toLowerCase()
  const id = EDITOR_ALIASES[key] ?? key
  const ids = EDITOR_BUNDLES[id] ?? [id]
  const match = editors.filter((editor) => ids.includes(editor.id))
  if (match.length === 0) {
    throw new Error(`Unknown editor '${name}'. Use one of: ${editorList()}`)
  }
  return match
}

export function editorOpenFileKind(name) {
  const id = canonicalEditorId(name)
  if (!id) return null
  return editors.find((editor) => editor.id === id)?.openFileKind ?? null
}

export function editorOpenFileLabel(name) {
  const kind = editorOpenFileKind(name)
  if (kind === 'cursor') return 'Cursor'
  if (kind === 'zed') return 'Zed'
  if (kind === 'vscode') return 'VS Code'
  return null
}

export function installEditors(projectRoot, name) {
  if (isAllEditors(name)) throw missingEditorError()
  return selectEditors(name).map((editor) => editor.install(projectRoot))
}

export function uninstallEditors(projectRoot, name) {
  return selectEditors(name).map((editor) => editor.uninstall(projectRoot))
}
