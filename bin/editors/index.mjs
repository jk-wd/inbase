import * as agents from './agents.mjs'
import * as claude from './claude.mjs'
import * as cline from './cline.mjs'
import * as copilot from './copilot.mjs'
import * as cursor from './cursor.mjs'

/** Ordered editor adapters. Add a module here to install skills for another editor. */
export const editors = [cursor, claude, agents, copilot, cline]

export function installEditors(projectRoot) {
  return editors.map((editor) => editor.install(projectRoot))
}
