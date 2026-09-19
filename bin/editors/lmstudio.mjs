import path from 'node:path'
import { removeEmptyParents } from '../project.mjs'
import { copySkillTree, removeSkillTree } from './layout.mjs'

export const id = 'lmstudio'
export const label = 'LM Studio'

const LAYOUT = { id, skillsRel: '.lmstudio/skills' }

export function install(projectRoot) {
  return {
    ...copySkillTree(projectRoot, LAYOUT),
    label,
  }
}

export function uninstall(projectRoot) {
  const result = removeSkillTree(projectRoot, LAYOUT)
  removeEmptyParents(path.join(projectRoot, '.lmstudio'), projectRoot)
  return { ...result, label }
}
