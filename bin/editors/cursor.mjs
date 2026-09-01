import fs from 'node:fs'
import path from 'node:path'
import { commandTemplateDir, copyDir, skillTemplateDir } from '../project.mjs'

export const id = 'cursor'

export function install(projectRoot) {
  if (!fs.existsSync(skillTemplateDir)) {
    throw new Error(`Inbase skill template missing at ${skillTemplateDir}`)
  }
  const skillDir = path.join(projectRoot, '.cursor/skills/inbase')
  copyDir(skillTemplateDir, skillDir)
  const commandDir = path.join(projectRoot, '.cursor/commands')
  if (fs.existsSync(commandTemplateDir)) {
    copyDir(commandTemplateDir, commandDir)
  }
  return { id, skillDir, commandDir }
}
