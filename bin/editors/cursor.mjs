import { copySkillAndCommands } from './layout.mjs'

export const id = 'cursor'
export const label = 'Cursor'

export function install(projectRoot) {
  return { ...copySkillAndCommands(projectRoot, {
    id,
    skillRel: '.cursor/skills/inbase',
    commandRel: '.cursor/commands',
  }), label }
}
