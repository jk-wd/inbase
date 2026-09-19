import { copySkillTree, removeSkillTree } from './layout.mjs'

export const id = 'bionic'
export const label = 'Bionic'

const LAYOUT = { id, skillsRel: '.agents/skills', listCommandSkills: true }

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
