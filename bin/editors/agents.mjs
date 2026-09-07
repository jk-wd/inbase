import { copySkillTree, removeSkillTree } from './layout.mjs'

export const id = 'agents'
export const label = 'Agent Skills'

const LAYOUT = { id, skillsRel: '.agents/skills' }

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
