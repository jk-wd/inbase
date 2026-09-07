import fs from 'node:fs'
import path from 'node:path'
import { removeEmptyParents } from '../project.mjs'
import {
  copySkillAndCommands,
  prependYamlFrontmatter,
  removeSkillAndCommands,
  sweepInbaseRules,
} from './layout.mjs'

export const id = 'claude'
export const label = 'Claude Code'

const LAYOUT = {
  id,
  skillRel: '.claude/skills/inbase',
  commandRel: '.claude/commands',
}

const SKILL_FRONTMATTER = [
  'user-invocable: false',
  'allowed-tools: Bash(npx inbase *)',
]

const COMMAND_FRONTMATTER = [
  'disable-model-invocation: true',
  'allowed-tools: Bash(npx inbase *)',
]

export function install(projectRoot) {
  const installed = copySkillAndCommands(projectRoot, LAYOUT)
  prependYamlFrontmatter(path.join(installed.skillDir, 'SKILL.md'), SKILL_FRONTMATTER)
  if (fs.existsSync(installed.commandDir)) {
    for (const name of fs.readdirSync(installed.commandDir)) {
      if (!name.endsWith('.md')) continue
      prependYamlFrontmatter(path.join(installed.commandDir, name), COMMAND_FRONTMATTER)
    }
  }
  return { ...installed, label }
}

export function uninstall(projectRoot) {
  const result = removeSkillAndCommands(projectRoot, LAYOUT)
  let removed = result.removed
  const rulesDir = path.join(projectRoot, '.claude/rules')
  if (sweepInbaseRules(rulesDir)) removed = true
  removeEmptyParents(rulesDir, projectRoot)
  return { ...result, removed, label }
}
