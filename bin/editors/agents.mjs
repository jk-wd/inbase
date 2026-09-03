import { copySkillTree } from './layout.mjs'

export const id = 'agents'
export const label = 'Agent Skills'

export function install(projectRoot) {
  return {
    ...copySkillTree(projectRoot, { id, skillsRel: '.agents/skills' }),
    label,
  }
}
