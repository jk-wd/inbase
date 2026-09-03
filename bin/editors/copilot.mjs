import { copySkillTree } from './layout.mjs'

export const id = 'copilot'
export const label = 'GitHub Copilot'

export function install(projectRoot) {
  return {
    ...copySkillTree(projectRoot, { id, skillsRel: '.github/skills' }),
    label,
  }
}
