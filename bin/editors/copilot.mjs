import { copySkillTree, removeSkillTree } from './layout.mjs'

export const id = 'copilot'
export const label = 'GitHub Copilot'

const LAYOUT = { id, skillsRel: '.github/skills' }

export function install(projectRoot) {
  return {
    ...copySkillTree(projectRoot, LAYOUT),
    label,
  }
}

export function uninstall(projectRoot) {
  return {
    ...removeSkillTree(projectRoot, LAYOUT),
    label,
  }
}
