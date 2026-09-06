import { copySkillTree } from './layout.mjs'

export const id = 'cline'
export const label = 'Cline'

export function install(projectRoot) {
  return {
    ...copySkillTree(projectRoot, { id, skillsRel: '.cline/skills' }),
    label,
  }
}
