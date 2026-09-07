import path from 'node:path'
import { removeEmptyParents } from '../project.mjs'
import {
  copySkillAndCommands,
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

export function install(projectRoot) {
  return { ...copySkillAndCommands(projectRoot, LAYOUT), label }
}

export function uninstall(projectRoot) {
  const result = removeSkillAndCommands(projectRoot, LAYOUT)
  let removed = result.removed
  const rulesDir = path.join(projectRoot, '.cursor/rules')
  if (sweepInbaseRules(rulesDir)) removed = true
  removeEmptyParents(rulesDir, projectRoot)
  return { ...result, removed, label }
}
